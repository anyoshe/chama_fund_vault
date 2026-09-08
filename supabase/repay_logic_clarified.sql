-- ============================================================
-- Clarified repay logic (matches product rules)
--
-- PRINCIPAL: restore liquidity kits only (frozen mix from disburse).
--            NEVER credit member personal balances with principal.
--
-- INTEREST:  reserve% → group-reserve (chama account)
--            remainder → members by frozen weights (basis at disburse)
--            single-kit basis → that kit only
--            four-kits basis → each member's share split across their
--              holdings in the 4 kits by their personal kit mix
-- ============================================================

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
  v_credit numeric;
  v_ref text;
  v_left numeric;
  v_uid uuid;
  v_member_share numeric;
  v_mem_kit_total numeric;
  v_kit_part numeric;
  r record;
  rk record;
  v_basis text;
  v_single_kit text;
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

  -- Interest first, then principal
  v_interest_pay := least(v_amount, coalesce(v_book.interest_remaining, 0));
  v_principal_pay := v_amount - v_interest_pay;

  -- ========== PRINCIPAL → group liquidity kits only ==========
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
          -- intentional: do NOT touch member_kit_balances for principal
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

  -- ========== INTEREST → reserve + members ==========
  if v_interest_pay > 0 then
    v_reserve_pct := coalesce(v_book.interest_reserve_pct, 20);
    v_reserve_amt := round((v_interest_pay * v_reserve_pct / 100)::numeric, 2);
    v_member_pool := v_interest_pay - v_reserve_amt;
    v_basis := coalesce(v_book.interest_split_basis, 'share-capital');

    update public.chama_kits
    set balance = balance + v_reserve_amt
    where chama_id = p_chama_id and kit_code = 'group-reserve';

    v_single_kit := case v_basis
      when 'table-banking' then 'table-banking'
      when 'member-loans' then 'member-loans'
      when 'share-capital' then 'share-capital'
      else null  -- four-kits handled below
    end;

    if v_member_pool > 0 and v_book.member_weights is not null
       and v_book.member_weights <> '{}'::jsonb then
      v_left := v_member_pool;

      for r in select key, value::text::numeric as w from jsonb_each(v_book.member_weights)
      loop
        v_uid := r.key::uuid;
        v_member_share := round((v_member_pool * r.w)::numeric, 2);
        if v_member_share > v_left then v_member_share := v_left; end if;
        if v_member_share <= 0 then continue; end if;

        if v_basis = 'four-kits' then
          -- Split this member's interest across their 4 liquidity kit holdings
          select coalesce(sum(b.balance), 0) into v_mem_kit_total
          from public.member_kit_balances b
          where b.chama_id = p_chama_id
            and b.user_id = v_uid
            and b.kit_code = any (public.loan_liquidity_codes())
            and b.balance > 0;

          if v_mem_kit_total > 0 then
            for rk in
              select b.kit_code, b.balance
              from public.member_kit_balances b
              where b.chama_id = p_chama_id
                and b.user_id = v_uid
                and b.kit_code = any (public.loan_liquidity_codes())
                and b.balance > 0
            loop
              v_kit_part := round((v_member_share * (rk.balance / v_mem_kit_total))::numeric, 2);
              if v_kit_part > 0 then
                insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
                values (p_chama_id, v_uid, rk.kit_code, v_kit_part, now())
                on conflict (chama_id, user_id, kit_code) do update set
                  balance = public.member_kit_balances.balance + excluded.balance,
                  updated_at = now();

                update public.chama_kits
                set balance = balance + v_kit_part
                where chama_id = p_chama_id and kit_code = rk.kit_code;
              end if;
            end loop;
          else
            -- No personal holdings: park in share-capital for that member
            insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
            values (p_chama_id, v_uid, 'share-capital', v_member_share, now())
            on conflict (chama_id, user_id, kit_code) do update set
              balance = public.member_kit_balances.balance + excluded.balance,
              updated_at = now();
            update public.chama_kits
            set balance = balance + v_member_share
            where chama_id = p_chama_id and kit_code = 'share-capital';
          end if;
        else
          -- Single-kit basis
          insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
          values (p_chama_id, v_uid, v_single_kit, v_member_share, now())
          on conflict (chama_id, user_id, kit_code) do update set
            balance = public.member_kit_balances.balance + excluded.balance,
            updated_at = now();

          update public.chama_kits
          set balance = balance + v_member_share
          where chama_id = p_chama_id and kit_code = v_single_kit;
        end if;

        v_left := v_left - v_member_share;
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
    'principal_to_member_balances', false,
    'principal_remaining', (select principal_remaining from public.loan_books where id = v_book.id),
    'interest_remaining', (select interest_remaining from public.loan_books where id = v_book.id),
    'status', (select status from public.loan_books where id = v_book.id),
    'reference', v_ref
  );
end;
$$;

grant execute on function public.repay_loan(uuid, text, numeric, text) to authenticated;
