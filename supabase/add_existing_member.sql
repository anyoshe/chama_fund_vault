-- Allow adding a person who already has an account to another chama.
-- Run once in Supabase SQL Editor.

create or replace function public.resolve_profile_id(
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_email text;
  v_id uuid;
begin
  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone := nullif(trim(coalesce(p_phone, '')), '');

  if v_phone is not null and v_phone ~ '^0[17][0-9]{8}$' then
    v_phone := '+254' || substring(v_phone from 2);
  elsif v_phone is not null and v_phone ~ '^254[17][0-9]{8}$' then
    v_phone := '+' || v_phone;
  end if;

  if v_phone is not null then
    select id into v_id from public.profiles where phone = v_phone limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if v_email is not null then
    select id into v_id from public.profiles where lower(email) = v_email limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.add_member_to_chama(
  p_chama_id uuid,
  p_user_id uuid,
  p_role text default 'Active Member',
  p_monthly_contribution numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_chama_officer(p_chama_id) then
    raise exception 'Only Chairperson, Treasurer or Secretary can add members';
  end if;

  if p_user_id is null then
    raise exception 'User is required';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That user has no profile in the system';
  end if;

  if exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id
      and user_id = p_user_id
      and status = 'active'
  ) then
    raise exception 'This person is already an active member of this chama';
  end if;

  v_role := coalesce(nullif(trim(p_role), ''), 'Active Member');

  insert into public.chama_members (
    chama_id, user_id, role, monthly_contribution, total_paid, active_loans, status
  ) values (
    p_chama_id,
    p_user_id,
    v_role,
    coalesce(p_monthly_contribution, 0),
    0,
    0,
    'active'
  )
  returning id into v_membership_id;

  return v_membership_id;
end;
$$;

grant execute on function public.resolve_profile_id(text, text) to authenticated;
grant execute on function public.add_member_to_chama(uuid, uuid, text, numeric) to authenticated;
