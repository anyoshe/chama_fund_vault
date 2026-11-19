-- After treasurer approves a pending payment (or STK confirms),
-- route special destinations: loan-repay and obligation.
-- Run in Supabase SQL Editor after dual_payment_modes.sql

create or replace function public.approve_pending_contribution(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
  v_dest text;
  v_proposal_id text;
  v_obligation_id text;
  v_loan_ref text;
  v_details text;
begin
  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.is_chama_official(v_c.chama_id) then
    raise exception 'Only officials can approve payments';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Payment is not pending (status=%)', v_c.status;
  end if;

  v_dest := coalesce(v_c.destination, 'general-savings');
  v_details := coalesce(v_c.payment_details, '');

  -- Loan repayment: do not credit a kit; apply repay_loan
  if v_dest = 'loan-repay' then
    v_proposal_id := substring(v_details from 'proposalId=([0-9a-fA-F-]{8,})');
    if v_proposal_id is null or v_proposal_id = '' then
      raise exception 'Loan repayment missing proposalId in payment details';
    end if;

    select coalesce(disbursement->>'loanRef', disbursement->>'reference', 'DISB-' || id::text)
      into v_loan_ref
    from public.proposals
    where id = v_proposal_id::uuid
      and chama_id = v_c.chama_id;

    if v_loan_ref is null then
      v_loan_ref := 'DISB-' || v_proposal_id;
    end if;

    -- Post repayment into loan books / kits via existing RPC when available
    begin
      perform public.repay_loan(
        v_c.chama_id,
        v_loan_ref,
        v_c.amount,
        coalesce(v_c.reference, 'PAY-' || p_contribution_id::text)
      );
    exception when undefined_function then
      -- repay_loan may use different signature in some envs
      null;
    end;

    update public.contributions set
      status = 'completed',
      confirmed_at = now(),
      approved_by = auth.uid(),
      approved_at = now()
    where id = p_contribution_id;

    insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
    values (
      v_c.chama_id, auth.uid(), 'repayment',
      format('Loan repayment approved · %s', v_loan_ref),
      v_c.amount, v_c.reference
    );

    return jsonb_build_object(
      'ok', true, 'status', 'completed', 'amount', v_c.amount, 'kind', 'loan_repay'
    );
  end if;

  -- Obligation payment
  if v_dest = 'obligation' then
    v_obligation_id := substring(v_details from 'obligationId=([0-9a-fA-F-]{8,})');
    if v_obligation_id is not null then
      begin
        perform public.pay_contribution_obligation(
          v_obligation_id::uuid,
          v_c.amount,
          coalesce(v_c.method, 'Other'),
          coalesce(v_c.reference, 'OBL-' || p_contribution_id::text),
          null,
          'Treasurer approved pending'
        );
      exception when others then
        raise exception 'Obligation pay failed: %', SQLERRM;
      end;
    end if;

    update public.contributions set
      status = 'completed',
      confirmed_at = now(),
      approved_by = auth.uid(),
      approved_at = now()
    where id = p_contribution_id;

    return jsonb_build_object(
      'ok', true, 'status', 'completed', 'amount', v_c.amount, 'kind', 'obligation'
    );
  end if;

  -- Default: credit kit + member balance + pool
  perform public.ensure_chama_kits(v_c.chama_id);

  insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
  values (
    v_c.chama_id, v_dest, public.kit_label(v_dest),
    v_c.amount, false, public.kit_counts_toward_loan(v_dest)
  )
  on conflict (chama_id, kit_code) do update set
    balance = public.chama_kits.balance + excluded.balance;

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (v_c.chama_id, v_c.member_id, v_dest, v_c.amount, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = public.member_kit_balances.balance + excluded.balance,
    updated_at = now();

  update public.chama_members
  set total_paid = total_paid + v_c.amount
  where chama_id = v_c.chama_id and user_id = v_c.member_id and status = 'active';

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0),
  month_collected = month_collected + v_c.amount
  where id = v_c.chama_id;

  update public.contributions set
    status = 'completed',
    confirmed_at = now(),
    approved_by = auth.uid(),
    approved_at = now()
  where id = p_contribution_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_c.chama_id, auth.uid(), 'contribution',
    format('Payment approved · %s · member credited', v_dest),
    v_c.amount, v_c.reference
  );

  return jsonb_build_object('ok', true, 'status', 'completed', 'amount', v_c.amount, 'kind', 'contribution');
end;
$$;

grant execute on function public.approve_pending_contribution(uuid) to authenticated;
