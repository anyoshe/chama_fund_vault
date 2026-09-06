-- ============================================================
-- Fix "Unknown member" — ensure profiles always have full_name
-- Run entire script in Supabase → SQL Editor → Run
-- ============================================================

-- 1) Robust trigger: never leave full_name empty; never break Auth
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
  begin
    v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
    v_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');

    if v_name is null or length(v_name) = 0 then
      v_name := split_part(coalesce(new.email, 'member'), '@', 1);
    end if;

    if v_phone is not null and v_phone ~ '^0[17][0-9]{8}$' then
      v_phone := '+254' || substring(v_phone from 2);
    elsif v_phone is not null and v_phone ~ '^254[17][0-9]{8}$' then
      v_phone := '+' || v_phone;
    end if;

    insert into public.profiles (id, full_name, email, phone, avatar_hue)
    values (
      new.id,
      v_name,
      coalesce(new.email, ''),
      v_phone,
      floor(random() * 360)::int
    )
    on conflict (id) do update set
      full_name = case
        when public.profiles.full_name is null
          or trim(public.profiles.full_name) = ''
          or public.profiles.full_name = 'Unknown member'
        then excluded.full_name
        else public.profiles.full_name
      end,
      email = coalesce(nullif(excluded.email, ''), public.profiles.email),
      phone = coalesce(excluded.phone, public.profiles.phone);
  exception
    when unique_violation then
      -- Phone taken by someone else: still ensure profile exists without phone
      begin
        insert into public.profiles (id, full_name, email, phone, avatar_hue)
        values (
          new.id,
          coalesce(
            nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
            split_part(coalesce(new.email, 'member'), '@', 1)
          ),
          coalesce(new.email, ''),
          null,
          floor(random() * 360)::int
        )
        on conflict (id) do update set
          full_name = case
            when public.profiles.full_name is null or trim(public.profiles.full_name) = ''
            then excluded.full_name
            else public.profiles.full_name
          end,
          email = coalesce(nullif(excluded.email, ''), public.profiles.email);
      exception when others then
        raise warning 'handle_new_user unique_violation fallback: %', sqlerrm;
      end;
    when others then
      raise warning 'handle_new_user failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) Backfill missing profile rows for any auth user without a profile
insert into public.profiles (id, full_name, email, phone, avatar_hue)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(u.email, 'member'), '@', 1)
  ),
  coalesce(u.email, ''),
  nullif(trim(u.raw_user_meta_data->>'phone'), ''),
  floor(random() * 360)::int
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 3) Backfill empty / placeholder names from auth metadata or email
update public.profiles p
set full_name = coalesce(
  nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
  nullif(trim(p.full_name), ''),
  split_part(coalesce(p.email, u.email, 'member'), '@', 1)
)
from auth.users u
where u.id = p.id
  and (
    p.full_name is null
    or trim(p.full_name) = ''
    or lower(trim(p.full_name)) in ('unknown member', 'unknown', 'member')
  );

-- 4) Ensure list RPCs exist (Dashboard / Members use these for names)
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
    and m.status = 'active'
    and (
      m.user_id = auth.uid()
      or public.is_chama_member(p_chama_id)
    );
$$;

grant execute on function public.is_chama_member(uuid) to authenticated, anon;
grant execute on function public.list_chama_members(uuid) to authenticated;
grant execute on function public.list_chama_profiles(uuid) to authenticated;

-- 5) Sanity check (optional — shows who still has weak names)
-- select id, full_name, email, phone from public.profiles
-- where full_name is null or trim(full_name) = '' or lower(full_name) like 'unknown%';
