-- ============================================================
-- Dual payment modes for chamas
-- 1) manual_confirm: member records payment → treasurer approves → kits update
-- 2) mpesa_stk: STK / API auto-credits (webhook completes); treasurer verifies
-- ============================================================

-- Ensure contributions can be pending until approved
do $$
begin
  -- status already exists on most installs; extend check if needed
  alter table public.contributions
    add column if not exists approved_by uuid references auth.users (id);
  alter table public.contributions
    add column if not exists approved_at timestamptz;
  alter table public.contributions
    add column if not exists payment_date date;
  alter table public.contributions
    add column if not exists paid_to_label text;
exception when others then null;
end $$;

create index if not exists contributions_pending_idx
  on public.contributions (chama_id, status)
  where status = 'pending';

-- Chama payment settings on constitution:
-- paymentMode: 'manual_confirm' | 'mpesa_stk' | 'both'
-- payToLabel: e.g. "Till 123456" or "Treasurer Jane 07xx"
-- payToPhone: optional

create or replace function public.set_chama_payment_mode(
  p_chama_id uuid,
  p_mode text,
  p_pay_to_label text default null,
  p_pay_to_phone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can set payment mode';
  end if;
  if p_mode not in ('manual_confirm', 'mpesa_stk', 'both') then
    raise exception 'Mode must be manual_confirm, mpesa_stk, or both';
  end if;
  update public.chamas
  set constitution = constitution
    || jsonb_build_object(
      'paymentMode', p_mode,
      'payToLabel', coalesce(nullif(trim(p_pay_to_label), ''), constitution->>'payToLabel'),
      'payToPhone', coalesce(nullif(trim(p_pay_to_phone), ''), constitution->>'payToPhone')
    )
  where id = p_chama_id;
end;
$$;

grant execute on function public.set_chama_payment_mode(uuid, text, text, text) to authenticated;

-- Member submits offline payment (does NOT credit kits until approved)
create or replace function public.submit_pending_contribution(
  p_chama_id uuid,
  p_amount numeric,
  p_destination text,
  p_method text,
  p_reference text,
  p_payment_date date default current_date,
  p_payment_details text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ref text;
  v_mode text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_amount is null or p_amount < 100 then
    raise exception 'Amount must be at least 100';
  end if;
  if nullif(trim(p_destination), '') is null then
    raise exception 'Choose a pot (destination)';
  end if;

  select coalesce(constitution->>'paymentMode', 'manual_confirm') into v_mode
  from public.chamas where id = p_chama_id;

  v_ref := coalesce(nullif(trim(p_reference), ''), 'PEND-' || substr(gen_random_uuid()::text, 1, 8));

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, payment_date, created_at
  ) values (
    p_chama_id,
    auth.uid(),
    p_amount,
    trim(p_destination),
    coalesce(nullif(trim(p_method), ''), 'Other'),
    nullif(trim(p_phone), ''),
    nullif(trim(p_payment_details), ''),
    v_ref,
    'pending',
    coalesce(p_payment_date, current_date),
    now()
  )
  on conflict (reference) do update set
    amount = excluded.amount,
    status = 'pending'
  returning id into v_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    p_chama_id, auth.uid(), 'contribution',
    format('Payment submitted for approval · %s · %s', trim(p_destination), v_ref),
    p_amount, v_ref
  );

  return jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'reference', v_ref,
    'message', 'Waiting for treasurer to confirm receipt'
  );
end;
$$;

grant execute on function public.submit_pending_contribution(uuid, numeric, text, text, text, date, text, text) to authenticated;

-- Treasurer/official approves → credit kits (reuse record path logic)
create or replace function public.approve_pending_contribution(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
  v_dest text;
begin
  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.is_chama_official(v_c.chama_id) then
    raise exception 'Only officials can approve payments';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Payment is not pending (status=%)', v_c.status;
  end if;

  v_dest := v_c.destination;

  -- Credit kit + member balance + pool
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

  return jsonb_build_object('ok', true, 'status', 'completed', 'amount', v_c.amount);
end;
$$;

grant execute on function public.approve_pending_contribution(uuid) to authenticated;

create or replace function public.reject_pending_contribution(
  p_contribution_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
begin
  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if not public.is_chama_official(v_c.chama_id) then
    raise exception 'Only officials can reject payments';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Not pending';
  end if;

  update public.contributions set
    status = 'rejected',
    payment_details = coalesce(payment_details || ' | ', '') || coalesce(p_reason, 'Rejected by official'),
    approved_by = auth.uid(),
    approved_at = now()
  where id = p_contribution_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_c.chama_id, auth.uid(), 'contribution',
    format('Payment rejected · %s', coalesce(p_reason, 'no reason')),
    v_c.amount, v_c.reference
  );

  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

grant execute on function public.reject_pending_contribution(uuid, text) to authenticated;

create or replace function public.list_pending_contributions(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can list pending payments';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'memberId', c.member_id,
      'amount', c.amount,
      'destination', c.destination,
      'method', c.method,
      'reference', c.reference,
      'paymentDate', c.payment_date,
      'paymentDetails', c.payment_details,
      'phone', c.phone,
      'createdAt', c.created_at
    ) order by c.created_at)
    from public.contributions c
    where c.chama_id = p_chama_id and c.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_pending_contributions(uuid) to authenticated;

-- STK placeholder: creates a pending or immediately completed row depending on mode
-- Real Daraja webhook should call complete_mpesa_contribution with the M-Pesa receipt
create or replace function public.request_mpesa_stk_contribution(
  p_chama_id uuid,
  p_amount numeric,
  p_destination text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_ref text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  if p_amount is null or p_amount < 100 then raise exception 'Invalid amount'; end if;

  select coalesce(constitution->>'paymentMode', 'manual_confirm') into v_mode
  from public.chamas where id = p_chama_id;

  if v_mode = 'manual_confirm' then
    raise exception 'This chama uses manual confirmation. Record your payment for the treasurer to approve.';
  end if;

  v_ref := 'STK-' || substr(gen_random_uuid()::text, 1, 10);

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    reference, status, payment_date, payment_details
  ) values (
    p_chama_id, auth.uid(), p_amount, trim(p_destination),
    'M-Pesa STK Push', nullif(trim(p_phone), ''),
    v_ref, 'pending', current_date,
    'STK initiated — awaiting M-Pesa callback'
  )
  returning id into v_id;

  -- Until Daraja is wired, return instructions; webhook will approve + credit
  return jsonb_build_object(
    'id', v_id,
    'reference', v_ref,
    'status', 'pending',
    'stkReady', false,
    'message', 'M-Pesa STK will prompt on your phone once Daraja is connected. Payment stays pending until M-Pesa confirms.'
  );
end;
$$;

grant execute on function public.request_mpesa_stk_contribution(uuid, numeric, text, text) to authenticated;

-- Called by webhook (service role) or official after verifying M-Pesa SMS
create or replace function public.complete_mpesa_contribution(
  p_contribution_id uuid,
  p_mpesa_receipt text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
begin
  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Not found'; end if;

  if v_c.status = 'completed' then
    return jsonb_build_object('ok', true, 'status', 'completed', 'already', true);
  end if;

  if nullif(trim(p_mpesa_receipt), '') is not null then
    update public.contributions set reference = trim(p_mpesa_receipt)
    where id = p_contribution_id;
  end if;

  return public.approve_pending_contribution(p_contribution_id);
end;
$$;

grant execute on function public.complete_mpesa_contribution(uuid, text) to authenticated;

-- Restrict approve/reject to Treasurer (or Chairperson as backup)
create or replace function public.approve_pending_contribution(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
  v_role text;
  v_dest text;
begin
  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Payment not found'; end if;

  select role into v_role from public.chama_members
  where chama_id = v_c.chama_id and user_id = auth.uid() and status = 'active';
  if v_role is distinct from 'Treasurer' and v_role is distinct from 'Chairperson' then
    raise exception 'Only the treasurer (or chairperson) can approve payments';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Payment is not pending (status=%)', v_c.status;
  end if;

  v_dest := v_c.destination;
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

  return jsonb_build_object('ok', true, 'status', 'completed', 'amount', v_c.amount);
end;
$$;

create or replace function public.reject_pending_contribution(
  p_contribution_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
  v_role text;
begin
  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Payment not found'; end if;
  select role into v_role from public.chama_members
  where chama_id = v_c.chama_id and user_id = auth.uid() and status = 'active';
  if v_role is distinct from 'Treasurer' and v_role is distinct from 'Chairperson' then
    raise exception 'Only the treasurer (or chairperson) can reject payments';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'Not pending';
  end if;

  update public.contributions set
    status = 'rejected',
    payment_details = coalesce(payment_details || ' | ', '') || coalesce(p_reason, 'Rejected by official'),
    approved_by = auth.uid(),
    approved_at = now()
  where id = p_contribution_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_c.chama_id, auth.uid(), 'contribution',
    format('Payment rejected · %s', coalesce(p_reason, 'no reason')),
    v_c.amount, v_c.reference
  );

  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;


-- Pending approval list: manual payments only (STK completes via callback)
create or replace function public.list_pending_contributions(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can list pending payments';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'memberId', c.member_id,
      'amount', c.amount,
      'destination', c.destination,
      'method', c.method,
      'reference', c.reference,
      'paymentDate', c.payment_date,
      'paymentDetails', c.payment_details,
      'phone', c.phone,
      'createdAt', c.created_at
    ) order by c.created_at)
    from public.contributions c
    where c.chama_id = p_chama_id
      and c.status = 'pending'
      and coalesce(c.method, '') not in ('M-Pesa STK Push', 'Airtel Money')
  ), '[]'::jsonb);
end;
$$;
