-- ============================================================
-- Loan books: freeze funding mix + member weights at disbursement
-- Repay: restore principal by mix; interest → group-reserve + members
-- ============================================================

-- Group reserve kit always available
create or replace function public.ensure_chama_kits(p_chama_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activities jsonb;
  v_code text;
begin
  select constitution->'activities' into v_activities
  from public.chamas where id = p_chama_id;

  if v_activities is null or jsonb_typeof(v_activities) <> 'array' or jsonb_array_length(v_activities) = 0 then
    v_activities := '["table-banking","member-loans","general-savings"]'::jsonb;
  end if;

  insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
  values (p_chama_id, 'member-loans', public.kit_label('member-loans'), true, false)
  on conflict (chama_id, kit_code) do update set
    label = excluded.label,
    is_loan_fund = true,
    counts_toward_loan_limit = false;

  -- Chama reserve account (interest retention)
  insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
  values (p_chama_id, 'group-reserve', 'Chama reserve', false, false)
  on conflict (chama_id, kit_code) do update set
    label = excluded.label,
    is_loan_fund = false,
    counts_toward_loan_limit = false;

  for v_code in select jsonb_array_elements_text(v_activities)
  loop
    insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
    values (
      p_chama_id,
      v_code,
      public.kit_label(v_code),
      (v_code = 'member-loans'),
      public.kit_counts_toward_loan(v_code)
    )
    on conflict (chama_id, kit_code) do update set
      label = excluded.label,
      counts_toward_loan_limit = excluded.counts_toward_loan_limit;
  end loop;
end;
$$;

create table if not exists public.loan_books (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  loan_ref text not null,
  borrower_id uuid not null references auth.users(id),
  principal numeric not null check (principal > 0),
  principal_remaining numeric not null check (principal_remaining >= 0),
  interest_total numeric not null default 0 check (interest_total >= 0),
  interest_remaining numeric not null default 0 check (interest_remaining >= 0),
  funding_allocations jsonb not null default '{}'::jsonb,
  member_weights jsonb not null default '{}'::jsonb,
  interest_split_basis text not null default 'share-capital',
  interest_reserve_pct numeric not null default 20,
  status text not null default 'active' check (status in ('active', 'settled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chama_id, loan_ref)
);

create index if not exists loan_books_chama_idx on public.loan_books (chama_id);
alter table public.loan_books enable row level security;

drop policy if exists loan_books_member_select on public.loan_books;
create policy loan_books_member_select on public.loan_books
  for select to authenticated
  using (public.is_chama_member(chama_id));

-- Snapshot member weights for interest distribution
create or replace function public.snapshot_interest_weights(
  p_chama_id uuid,
  p_basis text default 'share-capital'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weights jsonb := '{}'::jsonb;
  r record;
  v_total numeric := 0;
  v_basis text := coalesce(nullif(trim(p_basis), ''), 'share-capital');
begin
  if v_basis = 'four-kits' then
    for r in
      select b.user_id, coalesce(sum(b.balance), 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id
        and b.kit_code = any (public.loan_liquidity_codes())
      group by b.user_id
      having coalesce(sum(b.balance), 0) > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  elsif v_basis = 'table-banking' then
    for r in
      select b.user_id, coalesce(b.balance, 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id and b.kit_code = 'table-banking' and b.balance > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  elsif v_basis = 'member-loans' then
    for r in
      select b.user_id, coalesce(b.balance, 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id and b.kit_code = 'member-loans' and b.balance > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  else
    -- share-capital (default)
    for r in
      select b.user_id, coalesce(b.balance, 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id and b.kit_code = 'share-capital' and b.balance > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  end if;

  if v_total <= 0 then
    return '{}'::jsonb;
  end if;

  -- Convert absolute balances to fractions 0..1
  for r in select * from jsonb_each(v_weights)
  loop
    v_weights := jsonb_set(
      v_weights,
      array[r.key],
      to_jsonb(round((r.value::text::numeric / v_total)::numeric, 8))
    );
  end loop;

  return v_weights;
end;
$$;

-- Update disburse to open a loan_book with allocations + weights
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
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role = 'Treasurer' and status = 'active'
  ) then
    raise exception 'Only the official treasurer can disburse loans';
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
      update public.chama_kits set balance = balance - v_take
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
      update public.chama_kits set balance = balance - v_take
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
  v_interest := coalesce(p_interest_total, 0);
  if v_interest < 0 then v_interest := 0; end if;

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

-- Repay: principal → kits by frozen mix; interest → reserve + members
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
  v_reserve_amt numeric;
  v_member_pool numeric;
  v_alloc_total numeric;
  v_kit text;
  v_kit_amt numeric;
  v_uid text;
  v_w numeric;
  v_credit numeric;
  v_credit_kit text;
  v_ref text;
  v_left numeric;
  r record;
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

  select * into v_book
  from public.loan_books
  where chama_id = p_chama_id and loan_ref = p_loan_ref
  for update;

  if not found then
    raise exception 'Loan book not found for ref %', p_loan_ref;
  end if;
  if v_book.status = 'settled' then
    raise exception 'Loan already settled';
  end if;

  -- Only borrower (or treasurer) may post repayment
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
  if v_amount <= 0 then
    raise exception 'Nothing remaining on this loan';
  end if;

  -- Interest first, then principal
  v_interest_pay := least(v_amount, coalesce(v_book.interest_remaining, 0));
  v_principal_pay := v_amount - v_interest_pay;

  -- Principal restores funding kits by frozen absolute amounts ratio
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

  -- Interest: reserve % → group-reserve; rest → members by frozen weights
  if v_interest_pay > 0 then
    v_reserve_pct := coalesce(v_book.interest_reserve_pct, 20);
    v_reserve_amt := round((v_interest_pay * v_reserve_pct / 100)::numeric, 2);
    v_member_pool := v_interest_pay - v_reserve_amt;

    update public.chama_kits
    set balance = balance + v_reserve_amt
    where chama_id = p_chama_id and kit_code = 'group-reserve';

    -- Credit kit for member interest depends on basis
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
      end if;
    else
      -- No weights: all remaining interest to reserve
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

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, reference, status, confirmed_at
  ) values (
    p_chama_id, auth.uid(), v_amount, 'member-loans', 'Other', v_ref, 'completed', now()
  )
  on conflict (reference) do nothing;

  return jsonb_build_object(
    'ok', true,
    'amount', v_amount,
    'principal_applied', v_principal_pay,
    'interest_applied', v_interest_pay,
    'reserve_amount', coalesce(v_reserve_amt, 0),
    'member_interest_pool', coalesce(v_member_pool, 0),
    'principal_remaining', (select principal_remaining from public.loan_books where id = v_book.id),
    'interest_remaining', (select interest_remaining from public.loan_books where id = v_book.id),
    'status', (select status from public.loan_books where id = v_book.id),
    'reference', v_ref
  );
end;
$$;

grant execute on function public.repay_loan(uuid, text, numeric, text) to authenticated;
grant execute on function public.snapshot_interest_weights(uuid, text) to authenticated;
