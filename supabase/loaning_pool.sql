-- ============================================================
-- Loaning pool: table-banking + share-capital + general-savings + member-loans
-- Disburse proportionally from those kits.
-- Does NOT reduce member_kit_balances (used for interest / eligibility).
-- ============================================================

create or replace function public.loan_liquidity_codes()
returns text[]
language sql
immutable
as $$
  select array['table-banking', 'share-capital', 'general-savings', 'member-loans'];
$$;

create or replace function public.loaning_pool_balance(p_chama_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(k.balance), 0)
  from public.chama_kits k
  where k.chama_id = p_chama_id
    and k.kit_code = any (public.loan_liquidity_codes());
$$;

grant execute on function public.loaning_pool_balance(uuid) to authenticated;

create or replace function public.get_member_loan_limit(p_chama_id uuid, p_user_id uuid default auth.uid())
returns table (
  share_balance numeric,
  max_multiple numeric,
  max_loan numeric,
  loan_fund_balance numeric,
  active_loans int
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_shares numeric;
  v_mult numeric;
  v_pool numeric;
  v_loans int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from auth.uid() and not public.is_chama_member(p_chama_id) then
    raise exception 'Not allowed';
  end if;

  -- Eligibility = member's own contributions in share-like kits (unchanged by loans)
  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_user_id
    and k.counts_toward_loan_limit = true;

  select coalesce((c.constitution->>'maxLoanMultiple')::numeric, 3) into v_mult
  from public.chamas c
  where c.id = p_chama_id;

  -- Liquidity available to lend = loaning pool (4 kits)
  v_pool := public.loaning_pool_balance(p_chama_id);

  select coalesce(m.active_loans, 0) into v_loans
  from public.chama_members m
  where m.chama_id = p_chama_id
    and m.user_id = p_user_id
    and m.status = 'active';

  share_balance := coalesce(v_shares, 0);
  max_multiple := coalesce(v_mult, 3);
  max_loan := coalesce(v_shares, 0) * coalesce(v_mult, 3);
  -- Column name kept for API compatibility; value is full loaning pool
  loan_fund_balance := coalesce(v_pool, 0);
  active_loans := coalesce(v_loans, 0);
  return next;
end;
$$;

-- Proportionally debit liquidity kits; never touch member_kit_balances
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
  v_pool numeric;
  v_shares numeric;
  v_mult numeric;
  v_max numeric;
  v_ref text;
  r record;
  v_take numeric;
  v_remaining numeric;
  v_kit_total numeric;
  v_allocations jsonb := '{}'::jsonb;
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

  v_pool := public.loaning_pool_balance(p_chama_id);
  if v_pool < p_amount then
    raise exception 'Loaning pool has only %, cannot disburse %', v_pool, p_amount;
  end if;

  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_borrower_id
    and k.counts_toward_loan_limit = true;

  select coalesce((c.constitution->>'maxLoanMultiple')::numeric, 3) into v_mult
  from public.chamas c where c.id = p_chama_id;

  v_max := coalesce(v_shares, 0) * coalesce(v_mult, 3);
  if p_amount > v_max and v_max > 0 then
    raise exception 'Amount % exceeds borrower limit % (shares % × %)', p_amount, v_max, v_shares, v_mult;
  end if;

  -- Proportional draw from each liquidity kit with balance > 0
  v_remaining := p_amount;
  select coalesce(sum(k.balance), 0) into v_kit_total
  from public.chama_kits k
  where k.chama_id = p_chama_id
    and k.kit_code = any (public.loan_liquidity_codes())
    and k.balance > 0;

  for r in
    select k.kit_code, k.balance
    from public.chama_kits k
    where k.chama_id = p_chama_id
      and k.kit_code = any (public.loan_liquidity_codes())
      and k.balance > 0
    order by k.kit_code
  loop
    if v_remaining <= 0 then
      exit;
    end if;
    if v_kit_total > 0 then
      v_take := round((p_amount * (r.balance / v_kit_total))::numeric, 2);
    else
      v_take := 0;
    end if;
    if v_take > r.balance then
      v_take := r.balance;
    end if;
    if v_take > v_remaining then
      v_take := v_remaining;
    end if;
    if v_take > 0 then
      update public.chama_kits
      set balance = balance - v_take
      where chama_id = p_chama_id and kit_code = r.kit_code;
      v_allocations := v_allocations || jsonb_build_object(r.kit_code, v_take);
      v_remaining := v_remaining - v_take;
    end if;
  end loop;

  -- Rounding remainder: take from largest remaining liquidity kit
  if v_remaining > 0.001 then
    for r in
      select k.kit_code, k.balance
      from public.chama_kits k
      where k.chama_id = p_chama_id
        and k.kit_code = any (public.loan_liquidity_codes())
        and k.balance > 0
      order by k.balance desc
    loop
      if v_remaining <= 0 then
        exit;
      end if;
      v_take := least(r.balance, v_remaining);
      update public.chama_kits
      set balance = balance - v_take
      where chama_id = p_chama_id and kit_code = r.kit_code;
      v_allocations := v_allocations || jsonb_build_object(
        r.kit_code,
        coalesce((v_allocations->>r.kit_code)::numeric, 0) + v_take
      );
      v_remaining := v_remaining - v_take;
    end loop;
  end if;

  if v_remaining > 0.01 then
    raise exception 'Could not fully allocate disbursement; % left', v_remaining;
  end if;

  -- Member contribution balances intentionally NOT reduced (interest basis)

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
    'loaning_pool_remaining', public.loaning_pool_balance(p_chama_id),
    'allocations', v_allocations,
    'reference', v_ref,
    'member_shares_unchanged', true
  );
end;
$$;

-- Repayments: credit back proportionally to liquidity kits that currently exist
-- (simplest stable rule: put 100% back into member-loans first, overflow split)
-- User asked pool to refill — proportional to current kit targets or equal to original codes
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
  r record;
  v_codes text[] := public.loan_liquidity_codes();
  v_n int;
  v_each numeric;
  v_left numeric;
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

  v_n := array_length(v_codes, 1);
  v_each := round((p_amount / v_n)::numeric, 2);
  v_left := p_amount;

  foreach r in array (
    select kit_code from unnest(v_codes) as kit_code
  )
  loop
    null;
  end loop;

  -- Credit each liquidity kit equally (keeps pool composition balanced)
  for r in
    select unnest(v_codes) as kit_code
  loop
    update public.chama_kits
    set balance = balance + v_each
    where chama_id = p_chama_id and kit_code = r.kit_code;
    v_left := v_left - v_each;
  end loop;

  if abs(v_left) >= 0.01 then
    update public.chama_kits
    set balance = balance + v_left
    where chama_id = p_chama_id and kit_code = 'member-loans';
  end if;

  -- Audit row only — does not change member share totals for interest
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

  return jsonb_build_object(
    'ok', true,
    'amount', p_amount,
    'reference', v_ref,
    'loaning_pool', public.loaning_pool_balance(p_chama_id)
  );
end;
$$;
