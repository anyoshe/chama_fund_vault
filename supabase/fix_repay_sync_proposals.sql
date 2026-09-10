-- ============================================================
-- Fix: repay must reduce borrowed amount in DB (loan_books + proposals)
-- Kits were updating but proposal status/schedule often stayed "disbursed"
-- Run in Supabase SQL Editor
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
  v_amount numeric := p_amount;
  v_interest_pay numeric := 0;
  v_principal_pay numeric := 0;
  v_reserve_amt numeric := 0;
  v_member_pool numeric := 0;
  v_credit numeric;
  v_credit_kit text;
  v_left numeric;
  v_ref text;
  r record;
  v_new_prin numeric;
  v_new_int numeric;
  v_prop public.proposals%rowtype;
  v_sched jsonb;
  v_i int;
  v_left_sched numeric;
  v_row_amt numeric;
  v_new_sched jsonb := '[]'::jsonb;
  v_elem jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero';
  end if;

  select * into v_book
  from public.loan_books
  where chama_id = p_chama_id and loan_ref = p_loan_ref
  for update;

  if not found then
    raise exception 'Loan book not found for ref % — disburse must create loan_books', p_loan_ref;
  end if;

  if v_book.status = 'settled' then
    return jsonb_build_object(
      'ok', true,
      'already_settled', true,
      'principal_remaining', 0,
      'interest_remaining', 0
    );
  end if;

  -- Borrower or treasurer/chair can repay
  if auth.uid() <> v_book.borrower_id
     and not exists (
       select 1 from public.chama_members
       where chama_id = p_chama_id and user_id = auth.uid()
         and role in ('Treasurer', 'Chairperson') and status = 'active'
     )
  then
    raise exception 'Only the borrower or an official can post this repayment';
  end if;

  v_amount := least(
    v_amount,
    coalesce(v_book.principal_remaining, 0) + coalesce(v_book.interest_remaining, 0)
  );

  -- Interest first
  v_interest_pay := least(v_amount, coalesce(v_book.interest_remaining, 0));
  v_principal_pay := least(v_amount - v_interest_pay, coalesce(v_book.principal_remaining, 0));

  perform public.ensure_chama_kits(p_chama_id);

  -- Restore principal to kits by frozen allocations
  if v_principal_pay > 0 and v_book.funding_allocations is not null then
    for r in select * from jsonb_each_text(v_book.funding_allocations)
    loop
      v_credit := round((v_principal_pay * r.value::numeric) / 100.0, 2);
      if v_credit > 0 then
        update public.chama_kits
        set balance = balance + v_credit
        where chama_id = p_chama_id and kit_code = r.key;
      end if;
    end loop;
  elsif v_principal_pay > 0 then
    update public.chama_kits
    set balance = balance + v_principal_pay
    where chama_id = p_chama_id and kit_code = 'member-loans';
  end if;

  -- Interest split
  if v_interest_pay > 0 then
    v_reserve_amt := round(
      v_interest_pay * coalesce(v_book.interest_reserve_pct, 20) / 100.0,
      2
    );
    v_member_pool := v_interest_pay - v_reserve_amt;

    update public.chama_kits
    set balance = balance + v_reserve_amt
    where chama_id = p_chama_id and kit_code = 'group-reserve';

    v_credit_kit := case coalesce(v_book.interest_split_basis, 'share-capital')
      when 'table-banking' then 'table-banking'
      when 'member-loans' then 'member-loans'
      when 'four-kits' then 'share-capital'
      else 'share-capital'
    end;

    if v_book.member_weights is not null
       and jsonb_typeof(v_book.member_weights) = 'object'
       and v_member_pool > 0
    then
      v_left := v_member_pool;
      for r in select * from jsonb_each(v_book.member_weights)
      loop
        v_credit := round((v_member_pool * (r.value::text)::numeric), 2);
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
    elsif v_member_pool > 0 then
      update public.chama_kits
      set balance = balance + v_member_pool
      where chama_id = p_chama_id and kit_code = 'group-reserve';
      v_reserve_amt := v_reserve_amt + v_member_pool;
    end if;
  end if;

  v_new_prin := greatest(0, coalesce(v_book.principal_remaining, 0) - v_principal_pay);
  v_new_int := greatest(0, coalesce(v_book.interest_remaining, 0) - v_interest_pay);

  update public.loan_books set
    principal_remaining = v_new_prin,
    interest_remaining = v_new_int,
    status = case when v_new_prin <= 0.01 and v_new_int <= 0.01 then 'settled' else 'active' end,
    updated_at = now()
  where id = v_book.id;

  if v_new_prin <= 0.01 and v_new_int <= 0.01 then
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

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    p_chama_id,
    auth.uid(),
    'repayment',
    format(
      'Loan repay %s · principal %s · interest %s · left prin %s int %s',
      p_loan_ref, v_principal_pay, v_interest_pay, v_new_prin, v_new_int
    ),
    v_amount,
    v_ref
  );

  -- ===== Sync matching proposal (so UI outstanding comes from DB) =====
  select * into v_prop
  from public.proposals
  where chama_id = p_chama_id
    and type = 'loan'
    and status in ('disbursed', 'approved', 'active')
    and (
      disbursement->>'loanRef' = p_loan_ref
      or disbursement->>'reference' = p_loan_ref
      or ('DISB-' || id::text) = p_loan_ref
    )
  order by updated_at desc nulls last
  limit 1
  for update;

  if found then
    v_sched := coalesce(v_prop.repayment->'schedule', '[]'::jsonb);
    v_left_sched := v_amount;
    v_new_sched := '[]'::jsonb;

    for v_i in 0 .. greatest(jsonb_array_length(v_sched) - 1, -1)
    loop
      v_elem := v_sched->v_i;
      if v_elem is null then
        continue;
      end if;
      if coalesce((v_elem->>'paid')::boolean, false) then
        v_new_sched := v_new_sched || jsonb_build_array(v_elem);
        continue;
      end if;
      v_row_amt := coalesce((v_elem->>'amount')::numeric, 0);
      if v_left_sched >= v_row_amt - 0.001 then
        v_left_sched := v_left_sched - v_row_amt;
        v_new_sched := v_new_sched || jsonb_build_array(
          v_elem || jsonb_build_object('paid', true)
        );
      elsif v_left_sched > 0 then
        v_new_sched := v_new_sched || jsonb_build_array(
          v_elem || jsonb_build_object(
            'amount', round((v_row_amt - v_left_sched)::numeric, 2)
          )
        );
        v_left_sched := 0;
      else
        v_new_sched := v_new_sched || jsonb_build_array(v_elem);
      end if;
    end loop;

    -- If book cleared, mark all paid
    if v_new_prin <= 0.01 and v_new_int <= 0.01 then
      select coalesce(jsonb_agg(
        case
          when coalesce((e->>'paid')::boolean, false) then e
          else e || jsonb_build_object('paid', true)
        end
      ), '[]'::jsonb)
      into v_new_sched
      from jsonb_array_elements(v_new_sched) e;
    end if;

    update public.proposals set
      repayment = jsonb_build_object(
        'installments', coalesce((v_prop.repayment->>'installments')::int, jsonb_array_length(v_new_sched)),
        'monthlyPayment', coalesce((v_prop.repayment->>'monthlyPayment')::numeric, 0),
        'schedule', v_new_sched
      ),
      status = case
        when v_new_prin <= 0.01 and v_new_int <= 0.01 then 'settled'
        else 'disbursed'
      end,
      updated_at = now()
    where id = v_prop.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'principal_applied', v_principal_pay,
    'interest_applied', v_interest_pay,
    'reserve_amount', v_reserve_amt,
    'principal_remaining', v_new_prin,
    'interest_remaining', v_new_int,
    'status', case when v_new_prin <= 0.01 and v_new_int <= 0.01 then 'settled' else 'active' end,
    'proposal_synced', found
  );
end;
$$;

grant execute on function public.repay_loan(uuid, text, numeric, text) to authenticated;

-- Allow borrower to persist schedule/status when paying (not only treasurer)
create or replace function public.update_proposal_status(
  p_proposal_id uuid,
  p_status text,
  p_disbursement jsonb default null,
  p_repayment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.proposals%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_p from public.proposals where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if not public.is_chama_member(v_p.chama_id) then raise exception 'Not a member'; end if;

  if p_status = 'disbursed' then
    if not exists (
      select 1 from public.chama_members
      where chama_id = v_p.chama_id and user_id = v_uid
        and role = 'Treasurer' and status = 'active'
    ) then
      raise exception 'Only treasurer can disburse';
    end if;
  end if;

  -- settled / repayment updates: borrower or official
  if p_status in ('settled', 'disbursed') and p_repayment is not null then
    if v_uid <> v_p.requester_id
       and not exists (
         select 1 from public.chama_members
         where chama_id = v_p.chama_id and user_id = v_uid
           and role in ('Treasurer', 'Chairperson', 'Secretary') and status = 'active'
       )
    then
      -- still allow if only repayment schedule update by borrower on own loan
      if v_uid <> v_p.requester_id then
        raise exception 'Not allowed to update this proposal';
      end if;
    end if;
  end if;

  update public.proposals set
    status = p_status,
    disbursement = coalesce(p_disbursement, disbursement),
    repayment = coalesce(p_repayment, repayment),
    disbursed_at = case when p_status = 'disbursed' then coalesce(disbursed_at, now()) else disbursed_at end,
    updated_at = now()
  where id = p_proposal_id;

  return public.list_chama_proposals(v_p.chama_id);
end;
$$;

grant execute on function public.update_proposal_status(uuid, text, jsonb, jsonb) to authenticated;

-- One-shot: settle proposals whose loan_books are already settled
update public.proposals p
set status = 'settled',
    updated_at = now()
from public.loan_books b
where p.chama_id = b.chama_id
  and p.type = 'loan'
  and p.status = 'disbursed'
  and b.status = 'settled'
  and (
    p.disbursement->>'loanRef' = b.loan_ref
    or p.disbursement->>'reference' = b.loan_ref
    or ('DISB-' || p.id::text) = b.loan_ref
  );
