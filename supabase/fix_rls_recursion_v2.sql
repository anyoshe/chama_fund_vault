-- ============================================================
-- FIX v2: infinite recursion on chama_members (and 500s)
-- Run ENTIRE script in Supabase → SQL Editor → Run
-- ============================================================

-- A) Helper functions (owner bypasses RLS)
create or replace function public.is_chama_member(p_chama_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chama_members m
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
    select 1
    from public.chama_members m
    where m.chama_id = p_chama_id
      and m.user_id = auth.uid()
      and m.role in ('Chairperson', 'Treasurer', 'Secretary')
      and m.status = 'active'
  );
$$;

grant execute on function public.is_chama_member(uuid) to authenticated, anon;
grant execute on function public.is_chama_officer(uuid) to authenticated, anon;

-- B) Drop EVERY policy on these tables (names from v1 + originals)
do $$
declare
  r record;
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

-- C) Ensure RLS is on
alter table public.profiles enable row level security;
alter table public.chamas enable row level security;
alter table public.chama_members enable row level security;

-- D) PROFILES — only own row (no cross-table reads in policy)
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

-- E) CHAMAS
create policy "chamas_select"
  on public.chamas for select
  using (
    created_by = auth.uid()
    or public.is_chama_member(id)
  );

create policy "chamas_insert"
  on public.chamas for insert
  with check (auth.uid() = created_by);

create policy "chamas_update"
  on public.chamas for update
  using (
    created_by = auth.uid()
    or public.is_chama_officer(id)
  );

-- F) CHAMA_MEMBERS — critical: SELECT must NOT subquery chama_members via RLS
--    Own rows only with direct column check. Same-chama list via RPC below.
create policy "chama_members_select_own"
  on public.chama_members for select
  using (user_id = auth.uid());

create policy "chama_members_insert"
  on public.chama_members for insert
  with check (
    user_id = auth.uid()
    or public.is_chama_officer(chama_id)
  );

create policy "chama_members_update"
  on public.chama_members for update
  using (
    user_id = auth.uid()
    or public.is_chama_officer(chama_id)
  );

-- G) RPC so officers/members can list all members of a chama without recursive policies
create or replace function public.list_chama_members(p_chama_id uuid)
returns setof public.chama_members
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.chama_members m
  where m.chama_id = p_chama_id
    and (
      m.user_id = auth.uid()
      or public.is_chama_member(p_chama_id)
    );
$$;

grant execute on function public.list_chama_members(uuid) to authenticated;

-- H) Optional: allow reading profiles by id for users you share a chama with (via RPC)
create or replace function public.list_chama_profiles(p_chama_id uuid)
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  inner join public.chama_members m on m.user_id = p.id
  where m.chama_id = p_chama_id
    and public.is_chama_member(p_chama_id);
$$;

grant execute on function public.list_chama_profiles(uuid) to authenticated;
