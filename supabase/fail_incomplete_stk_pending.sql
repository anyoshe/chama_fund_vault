-- Mark M-Pesa rows that never completed as failed (not real payments)
-- Run once in Supabase SQL Editor if old pending STK clutter statements

update public.contributions
set status = 'failed',
    payment_details = coalesce(payment_details, '') || ' | marked failed — STK never confirmed'
where status = 'pending'
  and method = 'M-Pesa STK Push'
  and (
    payment_details ilike '%STK%'
    or payment_details ilike '%awaiting%'
    or payment_details is null
    or payment_details = ''
  )
  and confirmed_at is null
  and created_at < now() - interval '15 minutes';

-- Optional: remove very new test pendings that were never STK-configured
-- (uncomment if you want them gone entirely)
-- delete from public.contributions
-- where status = 'pending' and method = 'M-Pesa STK Push' and confirmed_at is null;
