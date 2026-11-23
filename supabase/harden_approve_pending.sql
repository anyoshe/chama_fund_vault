-- Harden approve_pending: credit kits, clear linked obligation, support obligationId in payment_details

alter table public.contributions
  add column if not exists obligation_id uuid references public.contribution_obligations (id);
alter table public.contributions
  add column if not exists approved_by uuid;
alter table public.contributions
  add column if not exists approved_at timestamptz;
alter table public.contributions
  add column if not exists confirmed_at timestamptz;

create or replace function public.approve_pending_contribution(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
  v_dest text;
  v_obl uuid;
  v_details text;
  v_kit_label text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_c from public.contributions where id = p_contribution_id for update;
  if not found then raise exception 'Payment not found'; end if;

  -- Treasurer preferred; chair may assist
  if not public.is_chama_official(v_c.chama_id) then
    raise exception 'Only officials can approve payments';
  end if;

  if v_c.status <> 'pending' then
    raise exception 'Payment is not pending (status=%)', v_c.status;
  end if;

  v_dest := coalesce(nullif(trim(v_c.destination), ''), 'general-savings');
  -- normalize retired welfare expense codes
  if v_dest ilike '%welfare%run%expense%' then
    v_dest := 'welfare';
  end if;

  -- Resolve obligation id from column or payment_details
  v_obl := v_c.obligation_id;
  v_details := coalesce(v_c.payment_details, '');
  if v_obl is null and v_details like '%obligationId=%' then
    begin
      v_obl := nullif(
        trim(both from split_part(split_part(v_details, 'obligationId=', 2), '|', 1)),
        ''
      )::uuid;
    exception when others then
      v_obl := null;
    end;
  end if;

  -- Ensure kits exist
  begin
    perform public.ensure_chama_kits(v_c.chama_id);
  exception when others then
    null;
  end;

  v_kit_label := initcap(replace(v_dest, '-', ' '));
  begin
    v_kit_label := public.kit_label(v_dest);
  exception when others then
    null;
  end;

  insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
  values (
    v_c.chama_id,
    v_dest,
    v_kit_label,
    v_c.amount,
    false,
    case
      when v_dest in ('table-banking', 'share-capital', 'general-savings') then true
      else false
    end
  )
  on conflict (chama_id, kit_code) do update set
    balance = public.chama_kits.balance + excluded.balance;

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (v_c.chama_id, v_c.member_id, v_dest, v_c.amount, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = public.member_kit_balances.balance + excluded.balance,
    updated_at = now();

  update public.chama_members
  set total_paid = coalesce(total_paid, 0) + v_c.amount
  where chama_id = v_c.chama_id and user_id = v_c.member_id and status = 'active';

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0),
  month_collected = coalesce(month_collected, 0) + v_c.amount
  where id = v_c.chama_id;

  update public.contributions set
    status = 'completed',
    destination = v_dest,
    obligation_id = coalesce(obligation_id, v_obl),
    confirmed_at = now(),
    approved_by = auth.uid(),
    approved_at = now()
  where id = p_contribution_id;

  -- Clear linked obligation (What I owe → 0)
  if v_obl is not null then
    update public.contribution_obligations o
    set
      paid_amount = least(
        o.expected_amount,
        coalesce(o.paid_amount, 0) + v_c.amount
      ),
      status = case
        when coalesce(o.paid_amount, 0) + v_c.amount >= o.expected_amount - 0.009
          then 'paid'
        else 'partial'
      end
    where o.id = v_obl
      and o.member_id = v_c.member_id;
  end if;

  -- Loan repay tag in payment_details
  if v_details like '%proposalId=%' and (v_dest = 'loan-repay' or v_details like '%loan%') then
    -- leave repay to dedicated repay_loan RPC; approval only marks contribution complete
    null;
  end if;

  begin
    insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
    values (
      v_c.chama_id, auth.uid(), 'contribution',
      format('Payment approved · %s · member credited', v_dest),
      v_c.amount, v_c.reference
    );
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'status', 'completed',
    'amount', v_c.amount,
    'destination', v_dest,
    'obligationId', v_obl
  );
end;
$$;

grant execute on function public.approve_pending_contribution(uuid) to authenticated;


-- When member submits manual pay linked to an obligation, store obligation_id
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
  v_obl uuid;
  v_details text;
  v_method text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'Enter an amount of at least Ksh 1';
  end if;
  if nullif(trim(p_destination), '') is null then
    raise exception 'Choose a pot';
  end if;

  v_details := coalesce(p_payment_details, '');
  if v_details like '%obligationId=%' then
    begin
      v_obl := nullif(
        trim(both from split_part(split_part(v_details, 'obligationId=', 2), '|', 1)),
        ''
      )::uuid;
    exception when others then
      v_obl := null;
    end;
  end if;

  v_method := case
    when nullif(trim(p_method), '') is null then 'Other'
    when trim(p_method) in ('M-Pesa STK Push','Airtel Money','Bank EFT / RTGS','PesaLink','Other','Cash','Bank Transfer')
      then trim(p_method)
    when trim(p_method) in ('Bank','Bank Transfer') then 'Bank EFT / RTGS'
    when trim(p_method) in ('Cash','Manual') then 'Other'
    else 'Other'
  end;

  v_ref := coalesce(
    nullif(trim(p_reference), ''),
    'PEND-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  );
  if exists (select 1 from public.contributions where reference = v_ref) then
    v_ref := v_ref || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, payment_date, created_at, created_by, obligation_id
  ) values (
    p_chama_id,
    auth.uid(),
    p_amount,
    trim(p_destination),
    v_method,
    nullif(trim(p_phone), ''),
    nullif(trim(v_details), ''),
    v_ref,
    'pending',
    coalesce(p_payment_date, current_date),
    now(),
    auth.uid(),
    v_obl
  )
  returning id into v_id;

  begin
    insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
    values (
      p_chama_id, auth.uid(), 'contribution',
      format('Payment submitted for approval · %s · %s', trim(p_destination), v_ref),
      p_amount, v_ref
    );
  exception when others then null;
  end;

  return jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'reference', v_ref,
    'obligationId', v_obl,
    'message', 'Waiting for treasurer to confirm receipt'
  );
end;
$$;

grant execute on function public.submit_pending_contribution(uuid, numeric, text, text, text, date, text, text) to authenticated;
