-- ChamaVault multi-tenant schema
-- Run this in the Supabase SQL Editor for your project.

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text unique,
  avatar_hue int not null default 150,
  created_at timestamptz not null default now()
);

-- Chamas (organizations / tenants)
create table if not exists public.chamas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text not null default '',
  kind text not null check (kind in ('merry-go-round', 'table-banking', 'welfare-pot', 'investment-pool', 'hybrid')),
  pool_balance numeric not null default 0,
  monthly_target numeric not null default 0,
  month_collected numeric not null default 0,
  constitution jsonb not null default '{
    "minMonthlyContribution": 5000,
    "lateFineRate": 5,
    "quorumPercent": 60,
    "maxLoanMultiple": 3,
    "payoutCycle": "1st Monday"
  }'::jsonb,
  currency text not null default 'KES',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

-- Membership (user ↔ chama + role)
create table if not exists public.chama_members (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('Chairperson', 'Treasurer', 'Secretary', 'Active Member', 'New Applicant')),
  monthly_contribution numeric not null default 0,
  total_paid numeric not null default 0,
  active_loans int not null default 0,
  status text not null default 'active' check (status in ('active', 'pending', 'suspended')),
  joined_at timestamptz not null default now(),
  unique (chama_id, user_id)
);

-- Indexes
create index if not exists idx_chama_members_user on public.chama_members (user_id);
create index if not exists idx_chama_members_chama on public.chama_members (chama_id);
create index if not exists idx_profiles_phone on public.profiles (phone);
create index if not exists idx_profiles_email on public.profiles (email);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone, avatar_hue)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    nullif(new.raw_user_meta_data->>'phone', ''),
    floor(random() * 360)::int
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone = coalesce(excluded.phone, public.profiles.phone);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.chamas enable row level security;
alter table public.chama_members enable row level security;

-- Profiles: users can read/update their own; members of same chama can read each other
create policy "Profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Allow reading profiles of people in the same chama
create policy "Profiles: read same-chama members"
  on public.profiles for select
  using (
    exists (
      select 1 from public.chama_members cm1
      join public.chama_members cm2 on cm1.chama_id = cm2.chama_id
      where cm1.user_id = auth.uid()
        and cm2.user_id = profiles.id
        and cm1.status = 'active'
        and cm2.status = 'active'
    )
  );

-- Chamas: members can read their chamas; creator can insert
create policy "Chamas: members can read"
  on public.chamas for select
  using (
    exists (
      select 1 from public.chama_members m
      where m.chama_id = chamas.id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
    or created_by = auth.uid()
  );

create policy "Chamas: authenticated can create"
  on public.chamas for insert
  with check (auth.uid() = created_by);

create policy "Chamas: officers can update"
  on public.chamas for update
  using (
    exists (
      select 1 from public.chama_members m
      where m.chama_id = chamas.id
        and m.user_id = auth.uid()
        and m.role in ('Chairperson', 'Treasurer', 'Secretary')
        and m.status = 'active'
    )
  );

-- Chama members
create policy "Members: read own memberships and same-chama"
  on public.chama_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.chama_members m
      where m.chama_id = chama_members.chama_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "Members: founder can insert self as chair"
  on public.chama_members for insert
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.chama_members m
      where m.chama_id = chama_members.chama_id
        and m.user_id = auth.uid()
        and m.role in ('Chairperson', 'Secretary')
        and m.status = 'active'
    )
  );

create policy "Members: officers can update"
  on public.chama_members for update
  using (
    exists (
      select 1 from public.chama_members m
      where m.chama_id = chama_members.chama_id
        and m.user_id = auth.uid()
        and m.role in ('Chairperson', 'Secretary')
        and m.status = 'active'
    )
  );

-- IMPORTANT: In Supabase Dashboard → Authentication → Providers
-- 1. Enable Email provider
-- 2. Disable "Confirm email" for local/dev testing (or configure SMTP)
-- Phone is stored on profiles; login by phone looks up email then uses password auth.
