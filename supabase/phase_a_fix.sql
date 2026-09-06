-- ============================================================
-- PHASE A FIX — run entire script in Supabase SQL Editor once
-- Makes: signup → confirm → login → real chama work reliably
-- ============================================================

-- 1) Helpers (security definer = bypass RLS inside function)
create or replace function public.is_chama_member(p_chama_id uuid)
returns boolean
language sql stable security definer set search_path = public
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
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chama_members m
    where m.chama_id = p_chama_id
      and m.user_id = auth.uid()
      and m.role in ('Chairperson', 'Treasurer', 'Secretary')
      and m.status = 'active'
  );
$$;

grant execute on function public.is_chama_member(uuid) to authenticated, anon;
grant execute on function public.is_chama_officer(uuid) to authenticated, anon;

-- 2) Drop ALL existing policies on core tables
do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'chamas', 'chama_members')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.chamas enable row level security;
alter table public.chama_members enable row level security;

-- Allow hybrid kind if constraint exists
alter table public.chamas drop constraint if exists chamas_kind_check;
alter table public.chamas
  add constraint chamas_kind_check
  check (kind in (
    'merry-go-round', 'table-banking', 'welfare-pot',
    'investment-pool', 'hybrid'
  ));

-- 3) Simple non-recursive policies
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "chamas_select"
  on public.chamas for select
  using (created_by = auth.uid() or public.is_chama_member(id));

create policy "chamas_insert"
  on public.chamas for insert
  with check (auth.uid() = created_by);

create policy "chamas_update"
  on public.chamas for update
  using (created_by = auth.uid() or public.is_chama_officer(id));

create policy "chama_members_select_own"
  on public.chama_members for select
  using (user_id = auth.uid());

create policy "chama_members_insert"
  on public.chama_members for insert
  with check (user_id = auth.uid() or public.is_chama_officer(chama_id));

create policy "chama_members_update"
  on public.chama_members for update
  using (user_id = auth.uid() or public.is_chama_officer(chama_id));

-- 4) Profile trigger — always store phone from signup metadata
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_name text;
begin
  v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
  v_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');

  if v_phone is not null and v_phone ~ '^0[17][0-9]{8}$' then
    v_phone := '+254' || substring(v_phone from 2);
  elsif v_phone is not null and v_phone ~ '^254[17][0-9]{8}$' then
    v_phone := '+' || v_phone;
  end if;

  insert into public.profiles (id, full_name, email, phone, avatar_hue)
  values (
    new.id,
    coalesce(v_name, split_part(new.email, '@', 1)),
    new.email,
    v_phone,
    floor(random() * 360)::int
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    email = excluded.email,
    phone = coalesce(excluded.phone, public.profiles.phone);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) ONE RPC to create chama + chair membership (avoids client RLS races)
create or replace function public.create_chama_with_founder(
  p_name text,
  p_tagline text,
  p_kind text,
  p_min_contribution numeric,
  p_activities jsonb default '[]'::jsonb,
  p_full_name text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chama_id uuid;
  v_phone text;
  v_kind text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Chama name is required';
  end if;

  v_kind := coalesce(nullif(trim(p_kind), ''), 'hybrid');
  if v_kind not in ('merry-go-round', 'table-banking', 'welfare-pot', 'investment-pool', 'hybrid') then
    v_kind := 'hybrid';
  end if;

  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  if v_phone is not null and v_phone ~ '^0[17][0-9]{8}$' then
    v_phone := '+254' || substring(v_phone from 2);
  elsif v_phone is not null and v_phone ~ '^254[17][0-9]{8}$' then
    v_phone := '+' || v_phone;
  end if;

  -- Ensure profile exists + phone saved
  insert into public.profiles (id, full_name, email, phone, avatar_hue)
  values (
    v_uid,
    coalesce(nullif(trim(p_full_name), ''), split_part(coalesce(auth.jwt()->>'email', 'member'), '@', 1)),
    coalesce(auth.jwt()->>'email', ''),
    v_phone,
    floor(random() * 360)::int
  )
  on conflict (id) do update set
    full_name = coalesce(nullif(trim(p_full_name), ''), public.profiles.full_name),
    phone = coalesce(v_phone, public.profiles.phone);

  insert into public.chamas (
    name, tagline, kind, pool_balance, monthly_target, month_collected,
    constitution, currency, created_by
  ) values (
    trim(p_name),
    coalesce(nullif(trim(p_tagline), ''), trim(p_name) || ' savings group'),
    v_kind,
    0,
    coalesce(p_min_contribution, 0),
    0,
    jsonb_build_object(
      'minMonthlyContribution', coalesce(p_min_contribution, 0),
      'lateFineRate', 5,
      'quorumPercent', 60,
      'maxLoanMultiple', 3,
      'payoutCycle', '1st Monday',
      'activities', coalesce(p_activities, '[]'::jsonb)
    ),
    'KES',
    v_uid
  )
  returning id into v_chama_id;

  insert into public.chama_members (
    chama_id, user_id, role, monthly_contribution, total_paid, active_loans, status
  ) values (
    v_chama_id, v_uid, 'Chairperson',
    coalesce(p_min_contribution, 0), 0, 0, 'active'
  );

  return v_chama_id;
end;
$$;

grant execute on function public.create_chama_with_founder(text, text, text, numeric, jsonb, text, text)
  to authenticated;

-- 6) List helpers for Members tab
create or replace function public.list_chama_members(p_chama_id uuid)
returns setof public.chama_members
language sql stable security definer set search_path = public
as $$
  select m.*
  from public.chama_members m
  where m.chama_id = p_chama_id
    and (m.user_id = auth.uid() or public.is_chama_member(p_chama_id));
$$;

create or replace function public.list_chama_profiles(p_chama_id uuid)
returns setof public.profiles
language sql stable security definer set search_path = public
as $$
  select p.*
  from public.profiles p
  inner join public.chama_members m on m.user_id = p.id
  where m.chama_id = p_chama_id
    and public.is_chama_member(p_chama_id);
$$;

grant execute on function public.list_chama_members(uuid) to authenticated;
grant execute on function public.list_chama_profiles(uuid) to authenticated;
