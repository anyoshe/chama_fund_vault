-- Ensure phone from signup metadata is stored on profiles.
-- Run once in Supabase SQL Editor. This is safe for projects created
-- before the phone column was added.

alter table public.profiles
  add column if not exists phone text;

create index if not exists idx_profiles_phone
  on public.profiles (phone);

update public.profiles
set phone = case
  when regexp_replace(trim(phone), '[\s\-()]', '', 'g') ~ '^0[17][0-9]{8}$'
    then '+254' || substring(regexp_replace(trim(phone), '[\s\-()]', '', 'g') from 2)
  when regexp_replace(trim(phone), '[\s\-()]', '', 'g') ~ '^254[17][0-9]{8}$'
    then '+' || regexp_replace(trim(phone), '[\s\-()]', '', 'g')
  else regexp_replace(trim(phone), '[\s\-()]', '', 'g')
end
where phone is not null;

create or replace function public.resolve_login_email(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.email
  from public.profiles p
  where regexp_replace(p.phone, '[\s\-()]', '', 'g') = case
    when regexp_replace(trim(p_phone), '[\s\-()]', '', 'g') ~ '^0[17][0-9]{8}$'
      then '+254' || substring(regexp_replace(trim(p_phone), '[\s\-()]', '', 'g') from 2)
    when regexp_replace(trim(p_phone), '[\s\-()]', '', 'g') ~ '^254[17][0-9]{8}$'
      then '+' || regexp_replace(trim(p_phone), '[\s\-()]', '', 'g')
    else regexp_replace(trim(p_phone), '[\s\-()]', '', 'g')
  end
  limit 1;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;

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

  -- Normalize Kenyan local 07... → +2547...
  if v_phone is not null and v_phone ~ '^0[17][0-9]{8}$' then
    v_phone := '+254' || substring(v_phone from 2);
  elsif v_phone is not null and v_phone ~ '^254[17][0-9]{8}$' then
    v_phone := '+' || v_phone;
  end if;

  -- A phone number may already belong to another profile. Do not let that
  -- optional field prevent Supabase Auth from creating the user.
  begin
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
  exception
    when unique_violation then
      insert into public.profiles (id, full_name, email, avatar_hue)
      values (
        new.id,
        coalesce(v_name, split_part(new.email, '@', 1)),
        new.email,
        floor(random() * 360)::int
      )
      on conflict (id) do update set
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        email = excluded.email;
  end;

  return new;
end;
$$;
