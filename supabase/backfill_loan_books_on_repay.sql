-- Ensure a loan_book exists for repayments of loans disbursed before loan_books.
-- Uses frozen allocations if provided; otherwise current liquidity mix (best estimate).

create or replace function public.ensure_loan_book(
  p_chama_id uuid,
  p_loan_ref text,
  p_borrower_id uuid,
  p_principal numeric,
  p_interest_total numeric default 0,
  p_principal_already_paid numeric default 0,
  p_interest_already_paid numeric default 0,
  p_allocations jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.loan_books%rowtype;
  v_allocations jsonb := coalesce(p_allocations, '{}'::jsonb);
  v_basis text;
  v_reserve numeric;
  v_weights jsonb;
  v_kit_total numeric;
  r record;
  v_principal numeric := greatest(coalesce(p_principal, 0), 0);
  v_interest numeric := greatest(coalesce(p_interest_total, 0), 0);
  v_prin_paid numeric := greatest(coalesce(p_principal_already_paid, 0), 0);
  v_int_paid numeric := greatest(coalesce(p_interest_already_paid, 0), 0);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_loan_ref is null or length(trim(p_loan_ref)) = 0 then
    raise exception 'loan_ref required';
  end if;
  if v_principal <= 0 then
    raise exception 'principal must be positive';
  end if;

  select * into v_existing
  from public.loan_books
  where chama_id = p_chama_id and loan_ref = p_loan_ref;

  if found then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'loan_ref', p_loan_ref,
      'principal_remaining', v_existing.principal_remaining,
      'interest_remaining', v_existing.interest_remaining,
      'status', v_existing.status
    );
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  -- If no frozen mix provided, estimate from current liquidity kit balances
  if v_allocations = '{}'::jsonb or v_allocations is null then
    select coalesce(sum(k.balance), 0) into v_kit_total
    from public.chama_kits k
    where k.chama_id = p_chama_id
      and k.kit_code = any (public.loan_liquidity_codes())
      and k.balance > 0;

    if v_kit_total > 0 then
      for r in
        select k.kit_code, k.balance
        from public.chama_kits k
        where k.chama_id = p_chama_id
          and k.kit_code = any (public.loan_liquidity_codes())
          and k.balance > 0
      loop
        v_allocations := v_allocations || jsonb_build_object(
          r.kit_code,
          round((v_principal * (r.balance / v_kit_total))::numeric, 2)
        );
      end loop;
    else
      -- Equal split across four codes if pots are empty
      v_allocations := jsonb_build_object(
        'table-banking', round(v_principal * 0.25, 2),
        'share-capital', round(v_principal * 0.25, 2),
        'general-savings', round(v_principal * 0.25, 2),
        'member-loans', round(v_principal * 0.25, 2)
      );
    end if;
  end if;

  select coalesce(c.constitution->>'interestSplitBasis', 'share-capital') into v_basis
  from public.chamas c where c.id = p_chama_id;
  select coalesce((c.constitution->>'interestReservePercent')::numeric, 20) into v_reserve
  from public.chamas c where c.id = p_chama_id;

  v_weights := public.snapshot_interest_weights(p_chama_id, v_basis);

  insert into public.loan_books (
    chama_id, loan_ref, borrower_id, principal, principal_remaining,
    interest_total, interest_remaining, funding_allocations, member_weights,
    interest_split_basis, interest_reserve_pct, status
  ) values (
    p_chama_id,
    p_loan_ref,
    p_borrower_id,
    v_principal,
    greatest(0, v_principal - v_prin_paid),
    v_interest,
    greatest(0, v_interest - v_int_paid),
    v_allocations,
    v_weights,
    coalesce(v_basis, 'share-capital'),
    coalesce(v_reserve, 20),
    case
      when greatest(0, v_principal - v_prin_paid) <= 0.01
       and greatest(0, v_interest - v_int_paid) <= 0.01
      then 'settled' else 'active'
    end
  );

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'loan_ref', p_loan_ref,
    'allocations', v_allocations,
    'member_weights', v_weights
  );
end;
$$;

grant execute on function public.ensure_loan_book(
  uuid, text, uuid, numeric, numeric, numeric, numeric, jsonb
) to authenticated;
