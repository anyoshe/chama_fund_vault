-- ============================================================
-- Phase 2–4: Treasurer payments, penalties, welfare events
-- Run AFTER phase1_contribution_plans.sql
-- ============================================================

-- ---------- Phase 2: Treasurer records payment for a member ----------
create or replace function public.record_obligation_payment_for_member(
  p_obligation_id uuid,
  p_amount numeric,
  p_method text default 'Cash',
  p_reference text default null,
  p_notes text default null
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
  v_ref text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_o from public.contribution_obligations where id = p_obligation_id for update;
  if not found then raise exception 'Obligation not found'; end if;

  if not public.is_chama_official(v_o.chama_id) then
    raise exception 'Only officials can record payments for members';
  end if;
  if v_o.status in ('paid', 'waived', 'cancelled') then
    raise exception 'Obligation is already %', v_o.status;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select * into v_plan from public.contribution_plans where id = v_o.plan_id;

  v_pay := least(p_amount, greatest(0, v_o.expected_amount - v_o.paid_amount));
  if not v_plan.allow_partial and v_pay + 0.001 < (v_o.expected_amount - v_o.paid_amount) then
    raise exception 'Partial payments are not allowed on this plan';
  end if;

  v_ref := coalesce(nullif(trim(p_reference), ''),
    'TR-' || substr(gen_random_uuid()::text, 1, 8));

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, confirmed_at, obligation_id, created_by
  ) values (
    v_o.chama_id, v_o.member_id, v_pay, v_plan.destination_kit,
    coalesce(nullif(trim(p_method), ''), 'Other'),
    null,
    coalesce(p_notes, 'Recorded by treasurer/official'),
    v_ref, 'completed', now(), v_o.id, auth.uid()
  );

  perform public.ensure_chama_kits(v_o.chama_id);

  insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
  values (
    v_o.chama_id, v_plan.destination_kit, public.kit_label(v_plan.destination_kit),
    v_pay, false, public.kit_counts_toward_loan(v_plan.destination_kit)
  )
  on conflict (chama_id, kit_code) do update set
    balance = public.chama_kits.balance + excluded.balance;

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (v_o.chama_id, v_o.member_id, v_plan.destination_kit, v_pay, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = public.member_kit_balances.balance + excluded.balance,
    updated_at = now();

  update public.chama_members
  set total_paid = total_paid + v_pay
  where chama_id = v_o.chama_id and user_id = v_o.member_id and status = 'active';

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
    paid_amount = v_new_paid,
    status = v_status,
    updated_at = now()
  where id = v_o.id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_o.chama_id, v_o.member_id, 'contribution',
    format('Official recorded payment for member · %s · %s · by %s',
      v_plan.name, v_o.period_key, auth.uid()::text),
    v_pay, v_ref
  );

  return jsonb_build_object(
    'ok', true,
    'obligationId', v_o.id,
    'memberId', v_o.member_id,
    'paid', v_pay,
    'status', v_status,
    'outstanding', greatest(0, v_o.expected_amount - v_new_paid)
  );
end;
$$;

grant execute on function public.record_obligation_payment_for_member(uuid, numeric, text, text, text) to authenticated;

-- ---------- Phase 3: Penalties ----------
alter table public.contribution_plans
  add column if not exists penalty_type text default 'none'
    check (penalty_type in ('none', 'fixed', 'percent'));
alter table public.contribution_plans
  add column if not exists penalty_fixed numeric default 0;
alter table public.contribution_plans
  add column if not exists penalty_percent numeric default 0;
alter table public.contribution_plans
  add column if not exists grace_days int default 0;
alter table public.contribution_plans
  add column if not exists max_penalty numeric;

create table if not exists public.contribution_penalties (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  obligation_id uuid not null references public.contribution_obligations (id) on delete cascade,
  member_id uuid not null references auth.users (id),
  amount numeric not null check (amount >= 0),
  status text not null default 'assessed'
    check (status in ('assessed', 'paid', 'waived')),
  reason text,
  waived_by uuid references auth.users (id),
  waived_reason text,
  created_at timestamptz not null default now(),
  unique (obligation_id)
);

create index if not exists contribution_penalties_chama_idx
  on public.contribution_penalties (chama_id, status);

alter table public.contribution_penalties enable row level security;
drop policy if exists penalties_select on public.contribution_penalties;
create policy penalties_select on public.contribution_penalties
  for select to authenticated
  using (member_id = auth.uid() or public.is_chama_member(chama_id));

create or replace function public.assess_overdue_penalties(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_amt numeric;
  v_count int := 0;
  v_grace int;
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can assess penalties';
  end if;

  for r in
    select o.*, p.penalty_type, p.penalty_fixed, p.penalty_percent,
           p.grace_days, p.max_penalty, p.name as plan_name
    from public.contribution_obligations o
    join public.contribution_plans p on p.id = o.plan_id
    where o.chama_id = p_chama_id
      and o.status in ('pending', 'partial')
      and o.due_date is not null
      and p.penalty_type in ('fixed', 'percent')
      and not exists (
        select 1 from public.contribution_penalties pen
        where pen.obligation_id = o.id
      )
  loop
    v_grace := coalesce(r.grace_days, 0);
    if current_date <= (r.due_date + v_grace) then
      continue;
    end if;

    if r.penalty_type = 'fixed' then
      v_amt := coalesce(r.penalty_fixed, 0);
    else
      v_amt := round(
        greatest(0, r.expected_amount - r.paid_amount)
        * coalesce(r.penalty_percent, 0) / 100.0, 2);
    end if;

    if r.max_penalty is not null and v_amt > r.max_penalty then
      v_amt := r.max_penalty;
    end if;
    if v_amt <= 0 then continue; end if;

    insert into public.contribution_penalties (
      chama_id, obligation_id, member_id, amount, status, reason
    ) values (
      p_chama_id, r.id, r.member_id, v_amt, 'assessed',
      format('Late on %s (%s)', r.plan_name, r.period_key)
    )
    on conflict (obligation_id) do nothing;

    insert into public.audit_events (chama_id, member_id, type, description, amount)
    values (
      p_chama_id, r.member_id, 'penalty',
      format('Penalty assessed · %s · %s', r.plan_name, r.period_key),
      v_amt
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('assessed', v_count);
end;
$$;

grant execute on function public.assess_overdue_penalties(uuid) to authenticated;

create or replace function public.waive_penalty(
  p_penalty_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.contribution_penalties%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_p from public.contribution_penalties where id = p_penalty_id for update;
  if not found then raise exception 'Penalty not found'; end if;
  if not public.is_chama_official(v_p.chama_id) then
    raise exception 'Only officials can waive penalties';
  end if;
  if v_p.status = 'waived' then
    return jsonb_build_object('ok', true, 'status', 'waived');
  end if;

  update public.contribution_penalties set
    status = 'waived',
    waived_by = auth.uid(),
    waived_reason = p_reason
  where id = p_penalty_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    v_p.chama_id, v_p.member_id, 'penalty',
    format('Penalty waived · %s', coalesce(p_reason, 'no reason')),
    v_p.amount
  );

  return jsonb_build_object('ok', true, 'status', 'waived');
end;
$$;

grant execute on function public.waive_penalty(uuid, text) to authenticated;

create or replace function public.list_chama_penalties(p_chama_id uuid)
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
      'id', pen.id,
      'obligationId', pen.obligation_id,
      'memberId', pen.member_id,
      'amount', pen.amount,
      'status', pen.status,
      'reason', pen.reason,
      'waivedReason', pen.waived_reason,
      'createdAt', pen.created_at
    ) order by pen.created_at desc)
    from public.contribution_penalties pen
    where pen.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_chama_penalties(uuid) to authenticated;

-- Update plan with penalty settings
create or replace function public.set_plan_penalty_rules(
  p_plan_id uuid,
  p_penalty_type text,
  p_penalty_fixed numeric default 0,
  p_penalty_percent numeric default 0,
  p_grace_days int default 0,
  p_max_penalty numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chama uuid;
begin
  select chama_id into v_chama from public.contribution_plans where id = p_plan_id;
  if v_chama is null then raise exception 'Plan not found'; end if;
  if not public.is_chama_official(v_chama) then
    raise exception 'Only officials can set penalty rules';
  end if;
  if p_penalty_type not in ('none', 'fixed', 'percent') then
    raise exception 'Invalid penalty type';
  end if;

  update public.contribution_plans set
    penalty_type = p_penalty_type,
    penalty_fixed = coalesce(p_penalty_fixed, 0),
    penalty_percent = coalesce(p_penalty_percent, 0),
    grace_days = coalesce(p_grace_days, 0),
    max_penalty = p_max_penalty,
    updated_at = now()
  where id = p_plan_id;
end;
$$;

grant execute on function public.set_plan_penalty_rules(uuid, text, numeric, numeric, int, numeric) to authenticated;

-- ---------- Phase 4: Welfare events ----------
create table if not exists public.welfare_events (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  title text not null,
  category text not null default 'other'
    check (category in (
      'death', 'family_death', 'sickness', 'hospitalization',
      'accident', 'emergency', 'education', 'other'
    )),
  beneficiary_id uuid references auth.users (id),
  beneficiary_name text,
  required_amount numeric not null default 0 check (required_amount >= 0),
  notes text,
  status text not null default 'open'
    check (status in ('open', 'collecting', 'closed')),
  plan_id uuid references public.contribution_plans (id),
  total_collected numeric not null default 0,
  total_expenses numeric not null default 0,
  total_payout numeric not null default 0,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.welfare_event_expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.welfare_events (id) on delete cascade,
  chama_id uuid not null references public.chamas (id) on delete cascade,
  amount numeric not null check (amount > 0),
  description text not null,
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists welfare_events_chama_idx on public.welfare_events (chama_id, status);

alter table public.welfare_events enable row level security;
alter table public.welfare_event_expenses enable row level security;

drop policy if exists welfare_events_select on public.welfare_events;
create policy welfare_events_select on public.welfare_events
  for select to authenticated
  using (public.is_chama_member(chama_id));

drop policy if exists welfare_exp_select on public.welfare_event_expenses;
create policy welfare_exp_select on public.welfare_event_expenses
  for select to authenticated
  using (public.is_chama_member(chama_id));

create or replace function public.create_welfare_event(
  p_chama_id uuid,
  p_title text,
  p_category text default 'other',
  p_required_amount numeric default 0,
  p_beneficiary_id uuid default null,
  p_beneficiary_name text default null,
  p_notes text default null,
  p_generate_obligations boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_plan_id uuid;
  v_period text;
  r record;
  v_count int := 0;
  v_cat text := coalesce(nullif(trim(p_category), ''), 'other');
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can create welfare events';
  end if;
  if nullif(trim(p_title), '') is null then raise exception 'Title required'; end if;
  if p_required_amount is null or p_required_amount < 0 then
    raise exception 'Invalid required amount';
  end if;
  if v_cat not in (
    'death', 'family_death', 'sickness', 'hospitalization',
    'accident', 'emergency', 'education', 'other'
  ) then
    v_cat := 'other';
  end if;

  -- One-off plan for this event (destination: contingency kit)
  insert into public.contribution_plans (
    chama_id, name, description, amount, frequency, destination_kit,
    is_mandatory, allow_partial, due_day, created_by
  ) values (
    p_chama_id,
    trim(p_title),
    coalesce(p_notes, 'Welfare event contribution'),
    greatest(p_required_amount, 0.01),
    'one_off',
    'contingency',
    true,
    true,
    null,
    auth.uid()
  )
  returning id into v_plan_id;

  insert into public.welfare_events (
    chama_id, title, category, beneficiary_id, beneficiary_name,
    required_amount, notes, status, plan_id, created_by
  ) values (
    p_chama_id, trim(p_title), v_cat, p_beneficiary_id, p_beneficiary_name,
    p_required_amount, p_notes, 'collecting', v_plan_id, auth.uid()
  )
  returning id into v_event_id;

  v_period := 'welfare-' || substr(v_event_id::text, 1, 8);

  if coalesce(p_generate_obligations, true) and p_required_amount > 0 then
    for r in
      select m.user_id
      from public.chama_members m
      where m.chama_id = p_chama_id
        and m.status = 'active'
        and m.role <> 'New Applicant'
    loop
      insert into public.contribution_obligations (
        chama_id, plan_id, member_id, period_key, due_date,
        expected_amount, paid_amount, status
      ) values (
        p_chama_id, v_plan_id, r.user_id, v_period, current_date + 7,
        p_required_amount, 0, 'pending'
      )
      on conflict (plan_id, member_id, period_key) do nothing;
      v_count := v_count + 1;
    end loop;
  end if;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'contribution',
    format('Welfare event opened: %s (%s) · %s obligations',
      trim(p_title), v_cat, v_count),
    p_required_amount
  );

  return jsonb_build_object(
    'id', v_event_id,
    'planId', v_plan_id,
    'title', trim(p_title),
    'obligationCount', v_count
  );
end;
$$;

grant execute on function public.create_welfare_event(uuid, text, text, numeric, uuid, text, text, boolean) to authenticated;

create or replace function public.list_welfare_events(p_chama_id uuid)
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
      'id', e.id,
      'title', e.title,
      'category', e.category,
      'beneficiaryId', e.beneficiary_id,
      'beneficiaryName', e.beneficiary_name,
      'requiredAmount', e.required_amount,
      'status', e.status,
      'planId', e.plan_id,
      'totalCollected', (
        select coalesce(sum(o.paid_amount), 0)
        from public.contribution_obligations o
        where o.plan_id = e.plan_id
      ),
      'totalExpected', (
        select coalesce(sum(o.expected_amount), 0)
        from public.contribution_obligations o
        where o.plan_id = e.plan_id
      ),
      'totalOutstanding', (
        select coalesce(sum(greatest(0, o.expected_amount - o.paid_amount)), 0)
        from public.contribution_obligations o
        where o.plan_id = e.plan_id and o.status in ('pending', 'partial')
      ),
      'totalExpenses', e.total_expenses,
      'totalPayout', e.total_payout,
      'balance', (
        select coalesce(sum(o.paid_amount), 0)
        from public.contribution_obligations o
        where o.plan_id = e.plan_id
      ) - e.total_expenses - e.total_payout,
      'createdAt', e.created_at
    ) order by e.created_at desc)
    from public.welfare_events e
    where e.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_welfare_events(uuid) to authenticated;

create or replace function public.record_welfare_expense(
  p_event_id uuid,
  p_amount numeric,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.welfare_events%rowtype;
begin
  select * into v_e from public.welfare_events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not public.is_chama_official(v_e.chama_id) then
    raise exception 'Only officials can record welfare expenses';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  -- Debit contingency kit
  perform public.record_expense_from_kit(
    v_e.chama_id, 'contingency', p_amount,
    coalesce(p_description, 'Welfare expense: ' || v_e.title),
    'welfare-' || substr(p_event_id::text, 1, 8),
    null
  );

  insert into public.welfare_event_expenses (
    event_id, chama_id, amount, description, recorded_by
  ) values (
    p_event_id, v_e.chama_id, p_amount,
    coalesce(p_description, 'Welfare expense'), auth.uid()
  );

  update public.welfare_events set
    total_expenses = total_expenses + p_amount
  where id = p_event_id;

  return jsonb_build_object('ok', true, 'amount', p_amount);
end;
$$;

grant execute on function public.record_welfare_expense(uuid, numeric, text) to authenticated;

create or replace function public.record_welfare_payout(
  p_event_id uuid,
  p_amount numeric,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.welfare_events%rowtype;
  v_collected numeric;
  v_balance numeric;
begin
  select * into v_e from public.welfare_events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if not public.is_chama_official(v_e.chama_id) then
    raise exception 'Only officials can record welfare payouts';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select coalesce(sum(o.paid_amount), 0) into v_collected
  from public.contribution_obligations o where o.plan_id = v_e.plan_id;

  v_balance := v_collected - v_e.total_expenses - v_e.total_payout;
  if p_amount > v_balance + 0.01 then
    raise exception 'Payout % exceeds event balance %', p_amount, v_balance;
  end if;

  perform public.record_expense_from_kit(
    v_e.chama_id, 'contingency', p_amount,
    coalesce(p_description, format('Welfare payout: %s', v_e.title)),
    'welfare-payout',
    null
  );

  update public.welfare_events set
    total_payout = total_payout + p_amount,
    status = case
      when (v_collected - v_e.total_expenses - v_e.total_payout - p_amount) <= 0.01
      then 'closed' else status end,
    closed_at = case
      when (v_collected - v_e.total_expenses - v_e.total_payout - p_amount) <= 0.01
      then now() else closed_at end
  where id = p_event_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    v_e.chama_id,
    coalesce(v_e.beneficiary_id, auth.uid()),
    'withdrawal',
    format('Welfare payout · %s · %s', v_e.title, coalesce(v_e.beneficiary_name, '')),
    p_amount
  );

  return jsonb_build_object('ok', true, 'amount', p_amount, 'eventId', p_event_id);
end;
$$;

grant execute on function public.record_welfare_payout(uuid, numeric, text) to authenticated;
