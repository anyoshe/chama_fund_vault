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

-- Helpers (security definer — avoid RLS recursion on chama_members)
create or replace function public.is_chama_member(p_chama_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chama_members m
    where m.chama_id = p_chama_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.is_chama_officer(p_chama_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chama_members m
    where m.chama_id = p_chama_id
      and m.user_id = auth.uid()
      and m.role in ('Chairperson', 'Treasurer', 'Secretary')
      and m.status = 'active'
  );
$$;

create or replace function public.shares_chama_with(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chama_members me
    join public.chama_members them
      on them.chama_id = me.chama_id and them.status = 'active'
    where me.user_id = auth.uid()
      and me.status = 'active'
      and them.user_id = p_other_user_id
  );
$$;

-- Profiles
create policy "Profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profiles: read same-chama members"
  on public.profiles for select
  using (public.shares_chama_with(id));

create policy "Profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Chamas
create policy "Chamas: members can read"
  on public.chamas for select
  using (public.is_chama_member(id) or created_by = auth.uid());

create policy "Chamas: authenticated can create"
  on public.chamas for insert
  with check (auth.uid() = created_by);

create policy "Chamas: officers can update"
  on public.chamas for update
  using (public.is_chama_officer(id));

-- Chama members
create policy "Members: read own or same-chama"
  on public.chama_members for select
  using (user_id = auth.uid() or public.is_chama_member(chama_id));

create policy "Members: insert self or officer"
  on public.chama_members for insert
  with check (user_id = auth.uid() or public.is_chama_officer(chama_id));

create policy "Members: officers can update"
  on public.chama_members for update
  using (public.is_chama_officer(chama_id));

-- IMPORTANT: In Supabase Dashboard → Authentication → Providers
-- 1. Enable Email provider
-- 2. Disable "Confirm email" for local/dev testing (or configure SMTP)
-- Phone is stored on profiles; login by phone looks up email then uses password auth.
