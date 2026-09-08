-- Run in Supabase SQL Editor (no auth.uid required)
-- 1) Diagnostics
-- 2) Force rebuild kits + member balances from contributions

-- ===== DIAGNOSTICS (see what you have) =====
select status, destination, count(*) as rows, coalesce(sum(amount), 0) as total
from public.contributions
group by status, destination
order by status, destination;

select kit_code, balance
from public.chama_kits
order by kit_code;

-- ===== FORCE REBUILD (keeps contribution rows; resets kit numbers) =====

-- Ensure kits exist for every chama
do $$
declare r record;
begin
  for r in select id from public.chamas loop
    perform public.ensure_chama_kits(r.id);
  end loop;
end $$;

-- Zero all kit pots
update public.chama_kits set balance = 0;

-- Fill from completed contributions (destination must match kit_code)
update public.chama_kits k
set balance = coalesce((
  select sum(c.amount)
  from public.contributions c
  where c.chama_id = k.chama_id
    and c.destination = k.kit_code
    and c.status = 'completed'
), 0);

-- Also accept common status variants if any rows used different labels
update public.chama_kits k
set balance = balance + coalesce((
  select sum(c.amount)
  from public.contributions c
  where c.chama_id = k.chama_id
    and c.destination = k.kit_code
    and c.status in ('complete', 'confirmed', 'paid', 'success')
), 0)
where exists (
  select 1 from public.contributions c
  where c.chama_id = k.chama_id
    and c.destination = k.kit_code
    and c.status in ('complete', 'confirmed', 'paid', 'success')
);

-- Member personal balances from contributions
delete from public.member_kit_balances;

insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
select
  c.chama_id,
  c.member_id,
  c.destination,
  sum(c.amount),
  now()
from public.contributions c
where c.status in ('completed', 'complete', 'confirmed', 'paid', 'success')
  and c.member_id is not null
  and c.destination is not null
  and exists (
    select 1 from public.chama_kits k
    where k.chama_id = c.chama_id and k.kit_code = c.destination
  )
group by c.chama_id, c.member_id, c.destination;

-- Sync group pool
update public.chamas c
set pool_balance = coalesce((
  select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
), 0);

-- Clear loan books so testing starts fresh (optional but recommended)
truncate public.loan_books;
update public.chama_members set active_loans = 0 where coalesce(active_loans, 0) <> 0;

-- ===== VERIFY =====
select kit_code, balance as kit_balance,
  coalesce((
    select sum(c.amount)
    from public.contributions c
    where c.chama_id = k.chama_id
      and c.destination = k.kit_code
      and c.status in ('completed', 'complete', 'confirmed', 'paid', 'success')
  ), 0) as contribution_total
from public.chama_kits k
order by kit_code;
