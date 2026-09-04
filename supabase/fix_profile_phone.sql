-- Ensure phone from signup metadata is stored on profiles.
-- Run once in Supabase SQL Editor.

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
