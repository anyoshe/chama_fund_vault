-- ============================================================
-- Welfare kitty: monthly vs registration sub-funds + expense approval
-- Run after phase1, phase2_4, fix_plans_obligations_auth
-- ============================================================

-- Sub-balances inside the welfare/emergency pot
create table if not exists public.welfare_fund_buckets (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  -- monthly_contribution | registration | other
  bucket_code text not null check (bucket_code in (
    'monthly_contribution', 'registration', 'other'
  )),
  label text not null,
  balance numeric not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  unique (chama_id, bucket_code)
);

create index if not exists welfare_fund_buckets_chama_idx
  on public.welfare_fund_buckets (chama_id);

alter table public.welfare_fund_buckets enable row level security;
drop policy if exists welfare_buckets_select on public.welfare_fund_buckets;
create policy welfare_buckets_select on public.welfare_fund_buckets
  for select to authenticated
  using (public.is_chama_member(chama_id));

create or replace function public.ensure_welfare_buckets(p_chama_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.welfare_fund_buckets (chama_id, bucket_code, label, balance)
  values
    (p_chama_id, 'monthly_contribution', 'Monthly contributions', 0),
    (p_chama_id, 'registration', 'Registration fees', 0),
    (p_chama_id, 'other', 'Other welfare', 0)
  on conflict (chama_id, bucket_code) do nothing;

  -- Ensure physical welfare kit exists (cash pot)
  perform public.ensure_chama_kits(p_chama_id);
  insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
  values (p_chama_id, 'welfare', public.kit_label('welfare'), 0, false, false)
  on conflict (chama_id, kit_code) do update set label = excluded.label;
end;
$$;

grant execute on function public.ensure_welfare_buckets(uuid) to authenticated;

-- Map destination kit / plan name → bucket
create or replace function public.welfare_bucket_for_destination(p_destination text)
returns text
language sql
immutable
as $$
  select case
    when p_destination in ('registration-fees', 'registration') then 'registration'
    when p_destination in ('welfare', 'contingency', 'table-banking', 'general-savings', 'member-loans')
      then 'monthly_contribution'
    else 'other'
  end;
$$;

-- Credit welfare kit + correct bucket (used when chama is welfare-mode)
create or replace function public.credit_welfare_kitty(
  p_chama_id uuid,
  p_amount numeric,
  p_bucket text,
  p_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := coalesce(nullif(trim(p_bucket), ''), 'monthly_contribution');
begin
  if p_amount is null or p_amount <= 0 then return; end if;
  perform public.ensure_welfare_buckets(p_chama_id);

  if v_bucket not in ('monthly_contribution', 'registration', 'other') then
    v_bucket := 'other';
  end if;

  update public.welfare_fund_buckets
  set balance = balance + p_amount, updated_at = now()
  where chama_id = p_chama_id and bucket_code = v_bucket;

  update public.chama_kits
  set balance = balance + p_amount
  where chama_id = p_chama_id and kit_code = 'welfare';

  if p_member_id is not null then
    insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
    values (p_chama_id, p_member_id, 'welfare', p_amount, now())
    on conflict (chama_id, user_id, kit_code) do update set
      balance = public.member_kit_balances.balance + excluded.balance,
      updated_at = now();
  end if;

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0)
  where id = p_chama_id;
end;
$$;

-- Spending policy on constitution:
-- welfareExpenseApproval: 'officials' | 'member_quorum'
-- (officials = chair/treasurer/secretary only; member_quorum = proposal vote)

create table if not exists public.welfare_expense_requests (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  title text not null,
  description text,
  amount numeric not null check (amount > 0),
  -- which sub-fund to debit
  bucket_code text not null check (bucket_code in (
    'monthly_contribution', 'registration', 'other'
  )),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'paid', 'cancelled')),
  approval_mode text not null default 'officials'
    check (approval_mode in ('officials', 'member_quorum')),
  proposal_id uuid references public.proposals (id),
  requested_by uuid references auth.users (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists welfare_expense_requests_chama_idx
  on public.welfare_expense_requests (chama_id, status);

alter table public.welfare_expense_requests enable row level security;
drop policy if exists welfare_exp_req_select on public.welfare_expense_requests;
create policy welfare_exp_req_select on public.welfare_expense_requests
  for select to authenticated
  using (public.is_chama_member(chama_id));

create or replace function public.get_welfare_expense_approval_mode(p_chama_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(constitution->>'welfareExpenseApproval'), ''),
    'officials'
  )
  from public.chamas where id = p_chama_id;
$$;

create or replace function public.set_welfare_expense_approval_mode(
  p_chama_id uuid,
  p_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can set expense approval mode';
  end if;
  if p_mode not in ('officials', 'member_quorum') then
    raise exception 'Mode must be officials or member_quorum';
  end if;
  update public.chamas
  set constitution = constitution || jsonb_build_object('welfareExpenseApproval', p_mode)
  where id = p_chama_id;
end;
$$;

grant execute on function public.set_welfare_expense_approval_mode(uuid, text) to authenticated;

-- Request welfare expense (officials propose; path depends on mode)
create or replace function public.request_welfare_expense(
  p_chama_id uuid,
  p_title text,
  p_amount numeric,
  p_bucket_code text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_id uuid;
  v_prop_id uuid;
  v_quorum numeric;
  v_bucket text := coalesce(nullif(trim(p_bucket_code), ''), 'monthly_contribution');
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can request welfare expenses';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'Title required'; end if;
  if v_bucket not in ('monthly_contribution', 'registration', 'other') then
    raise exception 'Invalid bucket';
  end if;

  perform public.ensure_welfare_buckets(p_chama_id);
  v_mode := public.get_welfare_expense_approval_mode(p_chama_id);

  insert into public.welfare_expense_requests (
    chama_id, title, description, amount, bucket_code,
    status, approval_mode, requested_by
  ) values (
    p_chama_id, trim(p_title), p_description, p_amount, v_bucket,
    'pending', v_mode, auth.uid()
  )
  returning id into v_id;

  if v_mode = 'member_quorum' then
    select coalesce((constitution->>'quorumPercent')::numeric, 60) / 100.0
    into v_quorum from public.chamas where id = p_chama_id;

    insert into public.proposals (
      chama_id, type, title, reason, amount, requester_id,
      status, quorum_threshold, votes
    ) values (
      p_chama_id,
      'expense',
      format('Welfare expense: %s', trim(p_title)),
      coalesce(p_description, format('Debit %s bucket', v_bucket)),
      p_amount,
      auth.uid(),
      'active',
      v_quorum,
      '{}'::jsonb
    )
    returning id into v_prop_id;

    update public.welfare_expense_requests
    set proposal_id = v_prop_id
    where id = v_id;
  end if;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'withdrawal',
    format('Welfare expense requested (%s): %s', v_mode, trim(p_title)),
    p_amount
  );

  return jsonb_build_object(
    'id', v_id,
    'approvalMode', v_mode,
    'proposalId', v_prop_id,
    'status', 'pending'
  );
end;
$$;

grant execute on function public.request_welfare_expense(uuid, text, numeric, text, text) to authenticated;

-- Officials approve (when mode = officials)
create or replace function public.decide_welfare_expense_official(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.welfare_expense_requests%rowtype;
  v_bal numeric;
begin
  select * into v_r from public.welfare_expense_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not public.is_chama_official(v_r.chama_id) then
    raise exception 'Only officials can decide this expense';
  end if;
  if v_r.approval_mode <> 'officials' then
    raise exception 'This expense requires member quorum voting, not official-only decision';
  end if;
  if v_r.status <> 'pending' then raise exception 'Request is not pending'; end if;

  if not p_approve then
    update public.welfare_expense_requests set
      status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where id = p_request_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  perform public.ensure_welfare_buckets(v_r.chama_id);

  select balance into v_bal from public.welfare_fund_buckets
  where chama_id = v_r.chama_id and bucket_code = v_r.bucket_code for update;

  if coalesce(v_bal, 0) < v_r.amount then
    raise exception 'Insufficient % bucket balance (have %)', v_r.bucket_code, coalesce(v_bal, 0);
  end if;

  update public.welfare_fund_buckets
  set balance = balance - v_r.amount, updated_at = now()
  where chama_id = v_r.chama_id and bucket_code = v_r.bucket_code;

  update public.chama_kits
  set balance = greatest(0, balance - v_r.amount)
  where chama_id = v_r.chama_id and kit_code = 'welfare';

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0)
  where id = v_r.chama_id;

  update public.welfare_expense_requests set
    status = 'paid', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_r.chama_id, auth.uid(), 'withdrawal',
    format('Welfare expense paid from %s: %s', v_r.bucket_code, v_r.title),
    v_r.amount, v_r.bucket_code
  );

  return jsonb_build_object('ok', true, 'status', 'paid', 'bucket', v_r.bucket_code);
end;
$$;

grant execute on function public.decide_welfare_expense_official(uuid, boolean) to authenticated;

-- After member quorum passes on linked proposal, execute debit
create or replace function public.execute_welfare_expense_after_vote(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.welfare_expense_requests%rowtype;
  v_prop public.proposals%rowtype;
  v_bal numeric;
  v_approvals int;
  v_required int;
  v_voters int;
begin
  select * into v_r from public.welfare_expense_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_r.approval_mode <> 'member_quorum' then
    raise exception 'Not a quorum-mode expense';
  end if;
  if v_r.status <> 'pending' then raise exception 'Not pending'; end if;
  if v_r.proposal_id is null then raise exception 'No linked proposal'; end if;

  select * into v_prop from public.proposals where id = v_r.proposal_id;
  if not found then raise exception 'Proposal missing'; end if;

  select count(*) into v_voters
  from public.chama_members
  where chama_id = v_r.chama_id and status = 'active' and role <> 'New Applicant';

  v_required := greatest(1, ceil(v_voters * coalesce(v_prop.quorum_threshold, 0.6)));
  select count(*) into v_approvals
  from jsonb_each_text(coalesce(v_prop.votes, '{}'::jsonb)) x
  where x.value = 'approve';

  if v_approvals < v_required and v_prop.status <> 'approved' then
    raise exception 'Quorum not reached (% / %)', v_approvals, v_required;
  end if;

  if not public.is_chama_official(v_r.chama_id) then
    raise exception 'Only an official can execute the approved expense';
  end if;

  perform public.ensure_welfare_buckets(v_r.chama_id);
  select balance into v_bal from public.welfare_fund_buckets
  where chama_id = v_r.chama_id and bucket_code = v_r.bucket_code for update;

  if coalesce(v_bal, 0) < v_r.amount then
    raise exception 'Insufficient % bucket (have %)', v_r.bucket_code, coalesce(v_bal, 0);
  end if;

  update public.welfare_fund_buckets
  set balance = balance - v_r.amount, updated_at = now()
  where chama_id = v_r.chama_id and bucket_code = v_r.bucket_code;

  update public.chama_kits
  set balance = greatest(0, balance - v_r.amount)
  where chama_id = v_r.chama_id and kit_code = 'welfare';

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0)
  where id = v_r.chama_id;

  update public.welfare_expense_requests set
    status = 'paid', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  update public.proposals set status = 'approved', updated_at = now()
  where id = v_r.proposal_id and status = 'active';

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_r.chama_id, auth.uid(), 'withdrawal',
    format('Welfare expense (quorum) from %s: %s', v_r.bucket_code, v_r.title),
    v_r.amount, v_r.bucket_code
  );

  return jsonb_build_object('ok', true, 'status', 'paid');
end;
$$;

grant execute on function public.execute_welfare_expense_after_vote(uuid) to authenticated;

create or replace function public.list_welfare_buckets(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  perform public.ensure_welfare_buckets(p_chama_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bucketCode', b.bucket_code,
      'label', b.label,
      'balance', b.balance
    ) order by b.bucket_code)
    from public.welfare_fund_buckets b
    where b.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_welfare_buckets(uuid) to authenticated;

create or replace function public.list_welfare_expense_requests(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'description', r.description,
      'amount', r.amount,
      'bucketCode', r.bucket_code,
      'status', r.status,
      'approvalMode', r.approval_mode,
      'proposalId', r.proposal_id,
      'createdAt', r.created_at
    ) order by r.created_at desc)
    from public.welfare_expense_requests r
    where r.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_welfare_expense_requests(uuid) to authenticated;

-- When obligation is paid into welfare-oriented kits, also credit buckets
-- Patch pay_contribution_obligation to credit welfare kitty when destination is welfare/contingency/registration
create or replace function public.pay_contribution_obligation(
  p_obligation_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_phone text default null,
  p_payment_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.contribution_obligations%rowtype;
  v_plan public.contribution_plans%rowtype;
  v_pay numeric;
  v_new_paid numeric;
  v_status text;
  v_contrib public.contributions%rowtype;
  v_bucket text;
  v_const jsonb;
  v_welfare_mode boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select * into v_o from public.contribution_obligations where id = p_obligation_id for update;
  if not found then raise exception 'Obligation not found'; end if;
  if v_o.member_id <> auth.uid() then
    raise exception 'You can only pay your own obligations';
  end if;
  if v_o.status in ('paid', 'waived', 'cancelled') then
    raise exception 'Obligation is already %', v_o.status;
  end if;

  select * into v_plan from public.contribution_plans where id = v_o.plan_id;
  v_pay := least(p_amount, greatest(0, v_o.expected_amount - v_o.paid_amount));
  if not v_plan.allow_partial and v_pay + 0.001 < (v_o.expected_amount - v_o.paid_amount) then
    raise exception 'Partial payments are not allowed on this plan';
  end if;

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, confirmed_at, obligation_id
  ) values (
    v_o.chama_id, auth.uid(), v_pay, v_plan.destination_kit,
    coalesce(nullif(trim(p_method), ''), 'Other'),
    nullif(trim(p_phone), ''), nullif(trim(p_payment_details), ''),
    trim(p_reference), 'completed', now(), v_o.id
  )
  on conflict (reference) do nothing
  returning * into v_contrib;

  if v_contrib.id is null then
    select * into v_contrib from public.contributions where reference = trim(p_reference);
  end if;

  select constitution into v_const from public.chamas where id = v_o.chama_id;
  v_welfare_mode := coalesce((v_const->>'channelContributionsToWelfare')::boolean, false)
    or v_plan.destination_kit in ('welfare', 'contingency', 'registration-fees');

  if v_welfare_mode then
    v_bucket := case
      when v_plan.destination_kit = 'registration-fees'
        or lower(v_plan.name) like '%registration%' then 'registration'
      else 'monthly_contribution'
    end;
    perform public.credit_welfare_kitty(v_o.chama_id, v_pay, v_bucket, auth.uid());
  else
    perform public.ensure_chama_kits(v_o.chama_id);
    insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
    values (
      v_o.chama_id, v_plan.destination_kit, public.kit_label(v_plan.destination_kit),
      v_pay, false, public.kit_counts_toward_loan(v_plan.destination_kit)
    )
    on conflict (chama_id, kit_code) do update set
      balance = public.chama_kits.balance + excluded.balance;

    insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
    values (v_o.chama_id, auth.uid(), v_plan.destination_kit, v_pay, now())
    on conflict (chama_id, user_id, kit_code) do update set
      balance = public.member_kit_balances.balance + excluded.balance,
      updated_at = now();
  end if;

  update public.chama_members
  set total_paid = total_paid + v_pay
  where chama_id = v_o.chama_id and user_id = auth.uid() and status = 'active';

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0),
  month_collected = month_collected + v_pay
  where id = v_o.chama_id;

  v_new_paid := v_o.paid_amount + v_pay;
  v_status := case
    when v_new_paid >= v_o.expected_amount - 0.01 then 'paid'
    when v_new_paid > 0 then 'partial'
    else 'pending'
  end;

  update public.contribution_obligations set
    paid_amount = v_new_paid, status = v_status, updated_at = now()
  where id = v_o.id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_o.chama_id, auth.uid(), 'contribution',
    format('Obligation payment · %s · %s', v_plan.name, v_o.period_key),
    v_pay, trim(p_reference)
  );

  return jsonb_build_object(
    'ok', true,
    'obligationId', v_o.id,
    'paid', v_pay,
    'paidAmount', v_new_paid,
    'outstanding', greatest(0, v_o.expected_amount - v_new_paid),
    'status', v_status,
    'welfareMode', v_welfare_mode
  );
end;
$$;

grant execute on function public.pay_contribution_obligation(uuid, numeric, text, text, text, text) to authenticated;

-- Enable welfare channeling flag
create or replace function public.set_channel_contributions_to_welfare(
  p_chama_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can change this setting';
  end if;
  update public.chamas
  set constitution = constitution || jsonb_build_object(
    'channelContributionsToWelfare', coalesce(p_enabled, false)
  )
  where id = p_chama_id;
  if p_enabled then
    perform public.ensure_welfare_buckets(p_chama_id);
  end if;
end;
$$;

grant execute on function public.set_channel_contributions_to_welfare(uuid, boolean) to authenticated;
