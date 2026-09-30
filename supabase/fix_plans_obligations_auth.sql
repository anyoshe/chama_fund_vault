-- ============================================================
-- Fix: auto-apply plans to ALL active members; strict official-only
-- Run after phase1 + phase2_4 SQL
-- ============================================================

-- Period key helper
create or replace function public.plan_period_key(p_frequency text, p_at date default current_date)
returns text
language sql
immutable
as $$
  select case coalesce(p_frequency, 'monthly')
    when 'one_off' then 'once'
    when 'weekly' then to_char(p_at, 'IYYY-"W"IW')
    when 'quarterly' then to_char(p_at, 'YYYY') || '-Q' || to_char(p_at, 'Q')
    when 'annually' then to_char(p_at, 'YYYY')
    else to_char(p_at, 'YYYY-MM')
  end;
$$;

-- Generate (or top-up) obligations for EVERY active member for a period
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
  v_inserted int := 0;
  v_total int := 0;
  r record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only Chairperson, Treasurer or Secretary can generate obligations';
  end if;

  select * into v_plan from public.contribution_plans
  where id = p_plan_id and chama_id = p_chama_id and is_active;
  if not found then raise exception 'Plan not found'; end if;

  v_period := coalesce(
    nullif(trim(p_period_key), ''),
    public.plan_period_key(v_plan.frequency, current_date)
  );

  if v_plan.frequency = 'monthly' then
    v_due := coalesce(
      p_due_date,
      make_date(
        split_part(v_period, '-', 1)::int,
        split_part(v_period, '-', 2)::int,
        least(coalesce(v_plan.due_day, 5), 28)
      )
    );
  else
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
      chama_id, plan_id, member_id, period_key, due_date,
      expected_amount, paid_amount, status
    ) values (
      p_chama_id, p_plan_id, r.user_id, v_period, v_due,
      v_plan.amount, 0, 'pending'
    )
    on conflict (plan_id, member_id, period_key) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  select count(*) into v_total
  from public.contribution_obligations
  where plan_id = p_plan_id and period_key = v_period;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'contribution',
    format(
      'Obligations for %s period %s · %s members (%s new)',
      v_plan.name, v_period, v_total, v_inserted
    ),
    v_plan.amount
  );

  return jsonb_build_object(
    'planId', p_plan_id,
    'periodKey', v_period,
    'dueDate', v_due,
    'obligationCount', v_total,
    'newlyCreated', v_inserted,
    'expectedEach', v_plan.amount
  );
end;
$$;

grant execute on function public.generate_plan_obligations(uuid, uuid, text, date) to authenticated;

-- Creating a plan ALSO generates obligations for the current period (all members)
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
  v_gen jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only Chairperson, Treasurer or Secretary can manage contribution plans';
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

  -- Auto-apply to all active members for current period
  select public.generate_plan_obligations(p_chama_id, v_id, null, null) into v_gen;

  return jsonb_build_object(
    'id', v_id,
    'name', trim(p_name),
    'obligations', v_gen
  );
end;
$$;

grant execute on function public.upsert_contribution_plan(uuid, text, numeric, text, text, int, boolean, boolean, text, uuid) to authenticated;

-- Sync new member into all active open periods (call when adding member)
create or replace function public.sync_member_plan_obligations(
  p_chama_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_period text;
  v_due date;
  v_n int := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (
    public.is_chama_official(p_chama_id)
    or auth.uid() = p_member_id
  ) then
    raise exception 'Not allowed';
  end if;

  for v_plan in
    select * from public.contribution_plans
    where chama_id = p_chama_id and is_active = true
  loop
    v_period := public.plan_period_key(v_plan.frequency, current_date);
    if v_plan.frequency = 'monthly' then
      begin
        v_due := make_date(
          split_part(v_period, '-', 1)::int,
          split_part(v_period, '-', 2)::int,
          least(coalesce(v_plan.due_day, 5), 28)
        );
      exception when others then
        v_due := current_date;
      end;
    else
      v_due := current_date;
    end if;

    insert into public.contribution_obligations (
      chama_id, plan_id, member_id, period_key, due_date,
      expected_amount, paid_amount, status
    ) values (
      p_chama_id, v_plan.id, p_member_id, v_period, v_due,
      v_plan.amount, 0, 'pending'
    )
    on conflict (plan_id, member_id, period_key) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;

  return jsonb_build_object('synced', v_n);
end;
$$;

grant execute on function public.sync_member_plan_obligations(uuid, uuid) to authenticated;

-- Harden treasurer payment (already official-only); ensure kit + obligation clear
-- (reaffirm record_obligation_payment_for_member from phase2_4)

-- Members must NOT call generate / upsert — already blocked by is_chama_official
-- Drop accidental grants if any public execute without check (N/A for security definer)

comment on function public.upsert_contribution_plan is
  'Officials only. Creates/updates plan and auto-generates obligations for all active members for the current period.';
comment on function public.generate_plan_obligations is
  'Officials only. Creates missing obligations for every active member (including newly joined).';
