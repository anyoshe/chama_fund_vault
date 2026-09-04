-- Fix: infinite recursion detected in policy for relation "chama_members"
-- Run this entire script once in Supabase → SQL Editor → Run

-- 1) Helper functions (bypass RLS via security definer — no recursion)
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
      on them.chama_id = me.chama_id
     and them.status = 'active'
    where me.user_id = auth.uid()
      and me.status = 'active'
      and them.user_id = p_other_user_id
  );
$$;

-- 2) Drop old recursive policies
drop policy if exists "Profiles: read same-chama members" on public.profiles;
drop policy if exists "Chamas: members can read" on public.chamas;
drop policy if exists "Chamas: officers can update" on public.chamas;
drop policy if exists "Members: read own memberships and same-chama" on public.chama_members;
drop policy if exists "Members: founder can insert self as chair" on public.chama_members;
drop policy if exists "Members: officers can update" on public.chama_members;

-- Keep these if they already exist; recreate cleanly
drop policy if exists "Profiles: read own" on public.profiles;
drop policy if exists "Profiles: update own" on public.profiles;
drop policy if exists "Profiles: insert own" on public.profiles;
drop policy if exists "Chamas: authenticated can create" on public.chamas;

-- 3) Profiles
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

-- 4) Chamas
create policy "Chamas: members can read"
  on public.chamas for select
  using (
    public.is_chama_member(id)
    or created_by = auth.uid()
  );

create policy "Chamas: authenticated can create"
  on public.chamas for insert
  with check (auth.uid() = created_by);

create policy "Chamas: officers can update"
  on public.chamas for update
  using (public.is_chama_officer(id));

-- 5) Chama members (NO self-subquery on chama_members in policy body)
create policy "Members: read own or same-chama"
  on public.chama_members for select
  using (
    user_id = auth.uid()
    or public.is_chama_member(chama_id)
  );

create policy "Members: insert self or officer"
  on public.chama_members for insert
  with check (
    user_id = auth.uid()
    or public.is_chama_officer(chama_id)
  );

create policy "Members: officers can update"
  on public.chama_members for update
  using (public.is_chama_officer(chama_id));
