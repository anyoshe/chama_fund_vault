-- ============================================================
-- Restore: kits REDUCE on disburse, INCREASE on principal repay
-- (for testing proportional return of funds)
-- ============================================================

-- Available pool = current kit balances (after debits)
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

-- Disburse: proportional DEBIT from kits + open loan_book
create or replace function public.disburse_from_loan_fund(
  p_chama_id uuid,
  p_amount numeric,
  p_borrower_id uuid,
  p_reference text default null,
  p_interest_total numeric default 0
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
  v_basis text;
  v_reserve numeric;
  v_weights jsonb;
  v_interest numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member of this chama'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role = 'Treasurer' and status = 'active'
  ) then
    raise exception 'Only the official treasurer can disburse loans';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  perform public.ensure_chama_kits(p_chama_id);

  v_pool := public.loaning_pool_balance(p_chama_id);
  if v_pool < p_amount then
    raise exception 'Loaning pool has only %, cannot disburse %', v_pool, p_amount;
  end if;

  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id and b.user_id = p_borrower_id
    and k.counts_toward_loan_limit = true;

  select coalesce((c.constitution->>'maxLoanMultiple')::numeric, 3) into v_mult
  from public.chamas c where c.id = p_chama_id;

  v_max := coalesce(v_shares, 0) * coalesce(v_mult, 3);
  if p_amount > v_max and v_max > 0 then
    raise exception 'Amount % exceeds borrower limit %', p_amount, v_max;
  end if;

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
    if v_remaining <= 0 then exit; end if;
    if v_kit_total > 0 then
      v_take := round((p_amount * (r.balance / v_kit_total))::numeric, 2);
    else
      v_take := 0;
    end if;
    if v_take > r.balance then v_take := r.balance; end if;
    if v_take > v_remaining then v_take := v_remaining; end if;
    if v_take > 0 then
      update public.chama_kits
      set balance = balance - v_take
      where chama_id = p_chama_id and kit_code = r.kit_code;
      v_allocations := v_allocations || jsonb_build_object(r.kit_code, v_take);
      v_remaining := v_remaining - v_take;
    end if;
  end loop;

  if v_remaining > 0.01 then
    for r in
      select k.kit_code, k.balance from public.chama_kits k
      where k.chama_id = p_chama_id
        and k.kit_code = any (public.loan_liquidity_codes())
        and k.balance > 0
      order by k.balance desc
    loop
      if v_remaining <= 0 then exit; end if;
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

  update public.chama_members
  set active_loans = coalesce(active_loans, 0) + 1
  where chama_id = p_chama_id and user_id = p_borrower_id and status = 'active';

  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = p_chama_id;

  select coalesce(c.constitution->>'interestSplitBasis', 'share-capital') into v_basis
  from public.chamas c where c.id = p_chama_id;
  select coalesce((c.constitution->>'interestReservePercent')::numeric, 20) into v_reserve
  from public.chamas c where c.id = p_chama_id;

  v_weights := public.snapshot_interest_weights(p_chama_id, v_basis);
  v_interest := greatest(coalesce(p_interest_total, 0), 0);
  v_ref := coalesce(nullif(trim(p_reference), ''), 'LOAN-' || substr(gen_random_uuid()::text, 1, 8));

  insert into public.loan_books (
    chama_id, loan_ref, borrower_id, principal, principal_remaining,
    interest_total, interest_remaining, funding_allocations, member_weights,
    interest_split_basis, interest_reserve_pct, status
  ) values (
    p_chama_id, v_ref, p_borrower_id, p_amount, p_amount,
    v_interest, v_interest, v_allocations, v_weights,
    coalesce(v_basis, 'share-capital'), coalesce(v_reserve, 20), 'active'
  )
  on conflict (chama_id, loan_ref) do update set
    principal = excluded.principal,
    principal_remaining = excluded.principal_remaining,
    interest_total = excluded.interest_total,
    interest_remaining = excluded.interest_remaining,
    funding_allocations = excluded.funding_allocations,
    member_weights = excluded.member_weights,
    interest_split_basis = excluded.interest_split_basis,
    interest_reserve_pct = excluded.interest_reserve_pct,
    status = 'active',
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'amount', p_amount,
    'borrower_id', p_borrower_id,
    'loaning_pool_remaining', public.loaning_pool_balance(p_chama_id),
    'allocations', v_allocations,
    'member_weights', v_weights,
    'loan_ref', v_ref,
    'interest_total', v_interest,
    'reference', v_ref
  );
end;
$$;

grant execute on function public.disburse_from_loan_fund(uuid, numeric, uuid, text, numeric) to authenticated;

-- Repay: principal RESTORES kits by frozen mix; interest → reserve + members
create or replace function public.repay_loan(
  p_chama_id uuid,
  p_loan_ref text,
  p_amount numeric,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book public.loan_books%rowtype;
  v_amount numeric;
  v_interest_pay numeric;
  v_principal_pay numeric;
  v_reserve_pct numeric;
  v_reserve_amt numeric := 0;
  v_member_pool numeric := 0;
  v_alloc_total numeric;
  v_kit_amt numeric;
  v_credit_kit text;
  v_credit numeric;
  v_ref text;
  v_left numeric;
  r record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member of this chama'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  perform public.ensure_chama_kits(p_chama_id);

  select * into v_book
  from public.loan_books
  where chama_id = p_chama_id and loan_ref = p_loan_ref
  for update;

  if not found then raise exception 'Loan book not found for ref %', p_loan_ref; end if;
  if v_book.status = 'settled' then raise exception 'Loan already settled'; end if;

  if auth.uid() is distinct from v_book.borrower_id
     and not exists (
       select 1 from public.chama_members
       where chama_id = p_chama_id and user_id = auth.uid()
         and role in ('Treasurer', 'Chairperson') and status = 'active'
     ) then
    raise exception 'Only the borrower or treasurer can record this repayment';
  end if;

  v_amount := least(
    p_amount,
    coalesce(v_book.principal_remaining, 0) + coalesce(v_book.interest_remaining, 0)
  );
  if v_amount <= 0 then raise exception 'Nothing remaining on this loan'; end if;

  v_interest_pay := least(v_amount, coalesce(v_book.interest_remaining, 0));
  v_principal_pay := v_amount - v_interest_pay;

  -- Principal restores kits by frozen disbursement mix
  if v_principal_pay > 0 then
    select coalesce(sum(value::text::numeric), 0) into v_alloc_total
    from jsonb_each(v_book.funding_allocations);

    if v_alloc_total > 0 then
      v_left := v_principal_pay;
      for r in select key, value::text::numeric as amt from jsonb_each(v_book.funding_allocations)
      loop
        v_kit_amt := round((v_principal_pay * (r.amt / v_alloc_total))::numeric, 2);
        if v_kit_amt > v_left then v_kit_amt := v_left; end if;
        if v_kit_amt > 0 then
          update public.chama_kits
          set balance = balance + v_kit_amt
          where chama_id = p_chama_id and kit_code = r.key;
          v_left := v_left - v_kit_amt;
        end if;
      end loop;
      if v_left > 0.01 then
        update public.chama_kits
        set balance = balance + v_left
        where chama_id = p_chama_id and kit_code = 'member-loans';
      end if;
    else
      update public.chama_kits
      set balance = balance + v_principal_pay
      where chama_id = p_chama_id and kit_code = 'member-loans';
    end if;
  end if;

  if v_interest_pay > 0 then
    v_reserve_pct := coalesce(v_book.interest_reserve_pct, 20);
    v_reserve_amt := round((v_interest_pay * v_reserve_pct / 100)::numeric, 2);
    v_member_pool := v_interest_pay - v_reserve_amt;

    update public.chama_kits
    set balance = balance + v_reserve_amt
    where chama_id = p_chama_id and kit_code = 'group-reserve';

    v_credit_kit := case v_book.interest_split_basis
      when 'table-banking' then 'table-banking'
      when 'member-loans' then 'member-loans'
      when 'four-kits' then 'share-capital'
      else 'share-capital'
    end;

    if v_member_pool > 0 and v_book.member_weights is not null
       and v_book.member_weights <> '{}'::jsonb then
      v_left := v_member_pool;
      for r in select key, value::text::numeric as w from jsonb_each(v_book.member_weights)
      loop
        v_credit := round((v_member_pool * r.w)::numeric, 2);
        if v_credit > v_left then v_credit := v_left; end if;
        if v_credit > 0 then
          insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
          values (p_chama_id, r.key::uuid, v_credit_kit, v_credit, now())
          on conflict (chama_id, user_id, kit_code) do update set
            balance = public.member_kit_balances.balance + excluded.balance,
            updated_at = now();
          update public.chama_kits
          set balance = balance + v_credit
          where chama_id = p_chama_id and kit_code = v_credit_kit;
          v_left := v_left - v_credit;
        end if;
      end loop;
      if v_left > 0.01 then
        update public.chama_kits
        set balance = balance + v_left
        where chama_id = p_chama_id and kit_code = 'group-reserve';
        v_reserve_amt := v_reserve_amt + v_left;
      end if;
    else
      update public.chama_kits
      set balance = balance + v_member_pool
      where chama_id = p_chama_id and kit_code = 'group-reserve';
      v_reserve_amt := v_reserve_amt + v_member_pool;
      v_member_pool := 0;
    end if;
  end if;

  update public.loan_books set
    principal_remaining = greatest(0, principal_remaining - v_principal_pay),
    interest_remaining = greatest(0, interest_remaining - v_interest_pay),
    status = case
      when greatest(0, principal_remaining - v_principal_pay) <= 0.01
       and greatest(0, interest_remaining - v_interest_pay) <= 0.01
      then 'settled' else 'active' end,
    updated_at = now()
  where id = v_book.id;

  if (select status from public.loan_books where id = v_book.id) = 'settled' then
    update public.chama_members
    set active_loans = greatest(0, coalesce(active_loans, 1) - 1)
    where chama_id = p_chama_id and user_id = v_book.borrower_id and status = 'active';
  end if;

  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = p_chama_id;

  v_ref := coalesce(nullif(trim(p_reference), ''), 'REPAY-' || substr(gen_random_uuid()::text, 1, 8));

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'principal_applied', v_principal_pay,
    'interest_applied', v_interest_pay,
    'reserve_amount', v_reserve_amt,
    'member_interest_pool', v_member_pool,
    'principal_remaining', (select principal_remaining from public.loan_books where id = v_book.id),
    'interest_remaining', (select interest_remaining from public.loan_books where id = v_book.id),
    'status', (select status from public.loan_books where id = v_book.id),
    'reference', v_ref
  );
end;
$$;

grant execute on function public.repay_loan(uuid, text, numeric, text) to authenticated;

-- ------------------------------------------------------------
-- CLEAN SLATE (run AFTER this file succeeds):
--   truncate public.loan_books;
--   update public.chama_members set active_loans = 0 where coalesce(active_loans, 0) <> 0;
--   select public.rebuild_kits_from_contributions(null::uuid);
-- ------------------------------------------------------------

-- Ensure rebuild exists (in case rebuild_kits_from_contributions.sql was never run)
create or replace function public.rebuild_kits_from_contributions(p_chama_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_chamas int := 0;
  v_kits int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  for r in
    select c.id
    from public.chamas c
    where p_chama_id is null or c.id = p_chama_id
  loop
    if p_chama_id is not null then
      if not exists (
        select 1 from public.chama_members m
        where m.chama_id = r.id and m.user_id = auth.uid()
          and m.role in ('Chairperson', 'Treasurer') and m.status = 'active'
      ) then
        raise exception 'Only chairperson or treasurer can rebuild kits';
      end if;
    end if;

    perform public.ensure_chama_kits(r.id);

    update public.chama_kits set balance = 0 where chama_id = r.id;

    update public.chama_kits k
    set balance = coalesce((
      select sum(c.amount)
      from public.contributions c
      where c.chama_id = k.chama_id
        and c.destination = k.kit_code
        and c.status = 'completed'
    ), 0)
    where k.chama_id = r.id;

    delete from public.member_kit_balances where chama_id = r.id;

    insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
    select
      c.chama_id,
      c.member_id,
      c.destination,
      sum(c.amount),
      now()
    from public.contributions c
    where c.chama_id = r.id
      and c.status = 'completed'
      and c.member_id is not null
      and c.destination is not null
    group by c.chama_id, c.member_id, c.destination;

    update public.chamas c
    set pool_balance = coalesce((
      select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
    ), 0)
    where c.id = r.id;

    v_chamas := v_chamas + 1;
    v_kits := v_kits + (select count(*) from public.chama_kits where chama_id = r.id);
  end loop;

  return jsonb_build_object('ok', true, 'chamas', v_chamas, 'kits', v_kits);
end;
$$;

grant execute on function public.rebuild_kits_from_contributions(uuid) to authenticated;
