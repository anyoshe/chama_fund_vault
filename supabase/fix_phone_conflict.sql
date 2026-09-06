-- Inspect who owns a phone number (change the number as needed)
-- select id, full_name, email, phone from public.profiles where phone = '+254725894055';

-- If that row is an abandoned test user and you want THIS logged-in user to own the phone:
-- 1) Find your auth user id: Authentication → Users → copy UUID
-- 2) Clear phone from the old profile, then set on yours:

-- update public.profiles set phone = null where phone = '+254725894055';
-- update public.profiles set phone = '+254725894055' where id = 'YOUR-USER-UUID-HERE';
