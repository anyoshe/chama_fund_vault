-- Kit operations: loan limit, disburse from loan fund, credit loan fund on repayment
-- Run AFTER kits_full.sql

create or replace function public.get_member_loan_limit(p_chama_id uuid, p_user_id uuid default auth.uid())
returns table (
  share_balance numeric,
  max_multiple numeric,
  max_loan numeric,
  loan_fund_balance numeric,
  active_loans int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shares numeric;
  v_mult numeric;
  v_fund numeric;
  v_loans int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from auth.uid() and not public.is_chama_member(p_chama_id) then
    raise exception 'Not allowed';
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_user_id
    and k.counts_toward_loan_limit = true;

  select coalesce((constitution->>'maxLoanMultiple')::numeric, 3) into v_mult
  from public.chamas where id = p_chama_id;

  select coalesce(balance, 0) into v_fund
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = 'member-loans';

  select coalesce(active_loans, 0) into v_loans
  from public.chama_members
  where chama_id = p_chama_id and user_id = p_user_id and status = 'active';

  return query select
    coalesce(v_shares, 0),
    coalesce(v_mult, 3),
    coalesce(v_shares, 0) * coalesce(v_mult, 3),
    coalesce(v_fund, 0),
    coalesce(v_loans, 0);
end;
$$;

grant execute on function public.get_member_loan_limit(uuid, uuid) to authenticated;

-- Pay out an approved loan from the loan-fund kit only
create or replace function public.disburse_from_loan_fund(
  p_chama_id uuid,
  p_amount numeric,
  p_borrower_id uuid,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fund numeric;
  v_shares numeric;
  v_mult numeric;
  v_max numeric;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  select coalesce(balance, 0) into v_fund
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = 'member-loans'
  for update;

  if v_fund < p_amount then
    raise exception 'Loan fund has only %, cannot disburse %', v_fund, p_amount;
  end if;

  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_borrower_id
    and k.counts_toward_loan_limit = true;

  select coalesce((constitution->>'maxLoanMultiple')::numeric, 3) into v_mult
  from public.chamas where id = p_chama_id;

  v_max := coalesce(v_shares, 0) * coalesce(v_mult, 3);
  if p_amount > v_max and v_max > 0 then
    raise exception 'Amount % exceeds borrower limit % (shares % × %)', p_amount, v_max, v_shares, v_mult;
  end if;

  update public.chama_kits
  set balance = balance - p_amount
  where chama_id = p_chama_id and kit_code = 'member-loans';

  update public.chama_members
  set active_loans = coalesce(active_loans, 0) + 1
  where chama_id = p_chama_id and user_id = p_borrower_id and status = 'active';

  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = p_chama_id;

  v_ref := coalesce(nullif(trim(p_reference), ''), 'LOAN-' || substr(gen_random_uuid()::text, 1, 8));

  return jsonb_build_object(
    'ok', true,
    'amount', p_amount,
    'borrower_id', p_borrower_id,
    'loan_fund_remaining', v_fund - p_amount,
    'reference', v_ref
  );
end;
$$;

grant execute on function public.disburse_from_loan_fund(uuid, numeric, uuid, text) to authenticated;

-- Credit loan fund (repayment). Does not use record_contribution destination rules.
create or replace function public.credit_loan_fund(
  p_chama_id uuid,
  p_amount numeric,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  update public.chama_kits
  set balance = balance + p_amount
  where chama_id = p_chama_id and kit_code = 'member-loans';

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (p_chama_id, auth.uid(), 'member-loans', p_amount, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = public.member_kit_balances.balance + excluded.balance,
    updated_at = now();

  -- Optional: track as contribution row for audit
  v_ref := coalesce(nullif(trim(p_reference), ''), 'REPAY-' || substr(gen_random_uuid()::text, 1, 8));
  insert into public.contributions (
    chama_id, member_id, amount, destination, method, reference, status, confirmed_at
  ) values (
    p_chama_id, auth.uid(), p_amount, 'member-loans', 'Other', v_ref, 'completed', now()
  )
  on conflict (reference) do nothing;

  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = p_chama_id;

  return jsonb_build_object('ok', true, 'amount', p_amount, 'reference', v_ref);
end;
$$;

grant execute on function public.credit_loan_fund(uuid, numeric, text) to authenticated;
