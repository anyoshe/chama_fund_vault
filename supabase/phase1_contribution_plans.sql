-- ============================================================
-- Phase 1: Contribution plans + member obligations
-- Does not remove kits or existing record_contribution.
-- Run in Supabase SQL Editor after contribution_persistence.sql
-- ============================================================

create table if not exists public.contribution_plans (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  name text not null,
  description text,
  amount numeric not null check (amount > 0),
  currency text not null default 'KES',
  -- one_off | weekly | monthly | quarterly | annually
  frequency text not null default 'monthly'
    check (frequency in ('one_off', 'weekly', 'monthly', 'quarterly', 'annually')),
  destination_kit text not null default 'general-savings',
  is_mandatory boolean not null default true,
  allow_partial boolean not null default false,
  allow_early boolean not null default true,
  -- day of month for monthly (1-28), null for one_off
  due_day int check (due_day is null or (due_day >= 1 and due_day <= 28)),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contribution_plans_chama_idx
  on public.contribution_plans (chama_id, is_active);

create table if not exists public.contribution_obligations (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  plan_id uuid not null references public.contribution_plans (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  -- e.g. 2026-09 for monthly, or plan id for one_off
  period_key text not null,
  due_date date,
  expected_amount numeric not null check (expected_amount >= 0),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'partial', 'paid', 'waived', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, member_id, period_key)
);

create index if not exists contribution_obligations_member_idx
  on public.contribution_obligations (chama_id, member_id, status);

create index if not exists contribution_obligations_plan_idx
  on public.contribution_obligations (plan_id, period_key);

-- Link payments to obligations (nullable for legacy rows)
alter table public.contributions
  add column if not exists obligation_id uuid references public.contribution_obligations (id);

alter table public.contribution_plans enable row level security;
alter table public.contribution_obligations enable row level security;

drop policy if exists plans_member_select on public.contribution_plans;
create policy plans_member_select on public.contribution_plans
  for select to authenticated
  using (public.is_chama_member(chama_id));

drop policy if exists obligations_member_select on public.contribution_obligations;
create policy obligations_member_select on public.contribution_obligations
  for select to authenticated
  using (
    member_id = auth.uid()
    or public.is_chama_member(chama_id)
  );

create or replace function public.is_chama_official(p_chama_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id
      and user_id = auth.uid()
      and status = 'active'
      and role in ('Chairperson', 'Treasurer', 'Secretary')
  );
$$;

grant execute on function public.is_chama_official(uuid) to authenticated;

-- Create / update plan (officials)
create or replace function public.upsert_contribution_plan(
  p_chama_id uuid,
  p_name text,
  p_amount numeric,
  p_frequency text default 'monthly',
  p_destination_kit text default 'general-savings',
  p_due_day int default 5,
  p_is_mandatory boolean default true,
  p_allow_partial boolean default false,
  p_description text default null,
  p_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_freq text := coalesce(nullif(trim(p_frequency), ''), 'monthly');
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can manage contribution plans';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  if v_freq not in ('one_off', 'weekly', 'monthly', 'quarterly', 'annually') then
    raise exception 'Invalid frequency';
  end if;

  if p_plan_id is not null then
    update public.contribution_plans set
      name = trim(p_name),
      description = p_description,
      amount = p_amount,
      frequency = v_freq,
      destination_kit = coalesce(nullif(trim(p_destination_kit), ''), 'general-savings'),
      due_day = case when v_freq = 'one_off' then null else coalesce(p_due_day, 5) end,
      is_mandatory = coalesce(p_is_mandatory, true),
      allow_partial = coalesce(p_allow_partial, false),
      updated_at = now()
    where id = p_plan_id and chama_id = p_chama_id
    returning id into v_id;
    if v_id is null then raise exception 'Plan not found'; end if;
  else
    insert into public.contribution_plans (
      chama_id, name, description, amount, frequency, destination_kit,
      due_day, is_mandatory, allow_partial, created_by
    ) values (
      p_chama_id, trim(p_name), p_description, p_amount, v_freq,
      coalesce(nullif(trim(p_destination_kit), ''), 'general-savings'),
      case when v_freq = 'one_off' then null else coalesce(p_due_day, 5) end,
      coalesce(p_is_mandatory, true),
      coalesce(p_allow_partial, false),
      auth.uid()
    )
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id, 'name', trim(p_name));
end;
$$;

grant execute on function public.upsert_contribution_plan(uuid, text, numeric, text, text, int, boolean, boolean, text, uuid) to authenticated;

create or replace function public.list_contribution_plans(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'chamaId', p.chama_id,
      'name', p.name,
      'description', p.description,
      'amount', p.amount,
      'currency', p.currency,
      'frequency', p.frequency,
      'destinationKit', p.destination_kit,
      'isMandatory', p.is_mandatory,
      'allowPartial', p.allow_partial,
      'allowEarly', p.allow_early,
      'dueDay', p.due_day,
      'isActive', p.is_active,
      'createdAt', p.created_at
    ) order by p.created_at)
    from public.contribution_plans p
    where p.chama_id = p_chama_id and p.is_active = true
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_contribution_plans(uuid) to authenticated;

-- Generate obligations for active members for a period
create or replace function public.generate_plan_obligations(
  p_chama_id uuid,
  p_plan_id uuid,
  p_period_key text default null,
  p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_period text;
  v_due date;
  v_count int := 0;
  r record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can generate obligations';
  end if;

  select * into v_plan from public.contribution_plans
  where id = p_plan_id and chama_id = p_chama_id and is_active;
  if not found then raise exception 'Plan not found'; end if;

  if v_plan.frequency = 'one_off' then
    v_period := coalesce(nullif(trim(p_period_key), ''), 'once');
    v_due := coalesce(p_due_date, current_date);
  elsif v_plan.frequency = 'monthly' then
    v_period := coalesce(nullif(trim(p_period_key), ''), to_char(current_date, 'YYYY-MM'));
    v_due := coalesce(
      p_due_date,
      make_date(
        split_part(v_period, '-', 1)::int,
        split_part(v_period, '-', 2)::int,
        least(coalesce(v_plan.due_day, 5), 28)
      )
    );
  else
    v_period := coalesce(nullif(trim(p_period_key), ''), to_char(current_date, 'YYYY-MM'));
    v_due := coalesce(p_due_date, current_date);
  end if;

  for r in
    select m.user_id
    from public.chama_members m
    where m.chama_id = p_chama_id
      and m.status = 'active'
      and m.role <> 'New Applicant'
  loop
    insert into public.contribution_obligations (
      chama_id, plan_id, member_id, period_key, due_date, expected_amount, paid_amount, status
    ) values (
      p_chama_id, p_plan_id, r.user_id, v_period, v_due, v_plan.amount, 0, 'pending'
    )
    on conflict (plan_id, member_id, period_key) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  -- count actual rows for period
  select count(*) into v_count
  from public.contribution_obligations
  where plan_id = p_plan_id and period_key = v_period;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'contribution',
    format('Generated obligations for plan %s period %s (%s members)', v_plan.name, v_period, v_count),
    v_plan.amount
  );

  return jsonb_build_object(
    'planId', p_plan_id,
    'periodKey', v_period,
    'dueDate', v_due,
    'obligationCount', v_count,
    'expectedEach', v_plan.amount
  );
end;
$$;

grant execute on function public.generate_plan_obligations(uuid, uuid, text, date) to authenticated;

create or replace function public.list_my_obligations(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'planId', o.plan_id,
      'planName', p.name,
      'destinationKit', p.destination_kit,
      'frequency', p.frequency,
      'periodKey', o.period_key,
      'dueDate', o.due_date,
      'expectedAmount', o.expected_amount,
      'paidAmount', o.paid_amount,
      'outstanding', greatest(0, o.expected_amount - o.paid_amount),
      'status', o.status,
      'allowPartial', p.allow_partial
    ) order by o.due_date nulls last, p.name)
    from public.contribution_obligations o
    join public.contribution_plans p on p.id = o.plan_id
    where o.chama_id = p_chama_id
      and o.member_id = auth.uid()
      and o.status in ('pending', 'partial')
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_my_obligations(uuid) to authenticated;

create or replace function public.list_chama_obligations(
  p_chama_id uuid,
  p_plan_id uuid default null,
  p_period_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id,
      'planId', o.plan_id,
      'planName', p.name,
      'memberId', o.member_id,
      'periodKey', o.period_key,
      'dueDate', o.due_date,
      'expectedAmount', o.expected_amount,
      'paidAmount', o.paid_amount,
      'outstanding', greatest(0, o.expected_amount - o.paid_amount),
      'status', o.status
    ) order by o.status, o.due_date nulls last)
    from public.contribution_obligations o
    join public.contribution_plans p on p.id = o.plan_id
    where o.chama_id = p_chama_id
      and (p_plan_id is null or o.plan_id = p_plan_id)
      and (p_period_key is null or o.period_key = p_period_key)
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_chama_obligations(uuid, uuid, text) to authenticated;

-- Pay against an obligation (member self-pay); credits kit via existing path
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
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select * into v_o from public.contribution_obligations where id = p_obligation_id for update;
  if not found then raise exception 'Obligation not found'; end if;
  if v_o.member_id <> auth.uid() then
    raise exception 'You can only pay your own obligations (Phase 1)';
  end if;
  if v_o.status in ('paid', 'waived', 'cancelled') then
    raise exception 'Obligation is already %', v_o.status;
  end if;

  select * into v_plan from public.contribution_plans where id = v_o.plan_id;

  v_pay := p_amount;
  if not v_plan.allow_partial then
    if v_pay + 0.001 < (v_o.expected_amount - v_o.paid_amount) then
      raise exception 'Partial payments are not allowed on this plan';
    end if;
  end if;

  -- Cap at outstanding
  v_pay := least(v_pay, greatest(0, v_o.expected_amount - v_o.paid_amount));

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

  -- Credit kit (same spirit as kits_operations)
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
    paid_amount = v_new_paid,
    status = v_status,
    updated_at = now()
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
    'contributionId', v_contrib.id
  );
end;
$$;

grant execute on function public.pay_contribution_obligation(uuid, numeric, text, text, text, text) to authenticated;

-- Seed default plans from constitution min monthly (optional helper for officials)
create or replace function public.seed_default_contribution_plans(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min numeric;
  v_n int := 0;
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can seed plans';
  end if;

  select coalesce((constitution->>'minMonthlyContribution')::numeric, 1000)
  into v_min from public.chamas where id = p_chama_id;

  if not exists (
    select 1 from public.contribution_plans
    where chama_id = p_chama_id and name = 'Monthly contribution' and is_active
  ) then
    perform public.upsert_contribution_plan(
      p_chama_id, 'Monthly contribution', v_min, 'monthly', 'table-banking', 5, true, false, 'Standard monthly savings', null
    );
    v_n := v_n + 1;
  end if;

  if not exists (
    select 1 from public.contribution_plans
    where chama_id = p_chama_id and name = 'Registration fee' and is_active
  ) then
    perform public.upsert_contribution_plan(
      p_chama_id, 'Registration fee', greatest(v_min, 300), 'one_off', 'registration-fees', null, true, false, 'One-time membership registration', null
    );
    v_n := v_n + 1;
  end if;

  return jsonb_build_object('seeded', v_n);
end;
$$;

grant execute on function public.seed_default_contribution_plans(uuid) to authenticated;
