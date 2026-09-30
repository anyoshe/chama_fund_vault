-- ============================================================
-- Remaining gaps: selected members, statements, arrears, reports,
-- spending policy, expense categories, payment methods, receipts
-- Run after welfare_kitty_expense_approval.sql
-- ============================================================

-- Selected members only for a plan
create table if not exists public.contribution_plan_members (
  plan_id uuid not null references public.contribution_plans (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  primary key (plan_id, member_id)
);

alter table public.contribution_plan_members enable row level security;
drop policy if exists plan_members_select on public.contribution_plan_members;
create policy plan_members_select on public.contribution_plan_members
  for select to authenticated
  using (
    exists (
      select 1 from public.contribution_plans p
      where p.id = plan_id and public.is_chama_member(p.chama_id)
    )
  );

alter table public.contribution_plans
  add column if not exists applies_to_all boolean not null default true;

create or replace function public.set_plan_members(
  p_plan_id uuid,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chama uuid;
  v_id uuid;
  v_n int := 0;
begin
  select chama_id into v_chama from public.contribution_plans where id = p_plan_id;
  if v_chama is null then raise exception 'Plan not found'; end if;
  if not public.is_chama_official(v_chama) then
    raise exception 'Only officials can set plan members';
  end if;

  update public.contribution_plans
  set applies_to_all = (p_member_ids is null or cardinality(p_member_ids) = 0),
      updated_at = now()
  where id = p_plan_id;

  delete from public.contribution_plan_members where plan_id = p_plan_id;

  if p_member_ids is not null then
    foreach v_id in array p_member_ids
    loop
      insert into public.contribution_plan_members (plan_id, member_id)
      values (p_plan_id, v_id)
      on conflict do nothing;
      v_n := v_n + 1;
    end loop;
    update public.contribution_plans set applies_to_all = false where id = p_plan_id;
  end if;

  return jsonb_build_object('planId', p_plan_id, 'memberCount', v_n, 'appliesToAll',
    (select applies_to_all from public.contribution_plans where id = p_plan_id));
end;
$$;

grant execute on function public.set_plan_members(uuid, uuid[]) to authenticated;

-- Patch generate to respect selected members
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
    raise exception 'Only officials can generate obligations';
  end if;

  select * into v_plan from public.contribution_plans
  where id = p_plan_id and chama_id = p_chama_id and is_active;
  if not found then raise exception 'Plan not found'; end if;

  v_period := coalesce(
    nullif(trim(p_period_key), ''),
    public.plan_period_key(v_plan.frequency, current_date)
  );

  if v_plan.frequency = 'monthly' then
    begin
      v_due := coalesce(
        p_due_date,
        make_date(
          split_part(v_period, '-', 1)::int,
          split_part(v_period, '-', 2)::int,
          least(coalesce(v_plan.due_day, 5), 28)
        )
      );
    exception when others then
      v_due := coalesce(p_due_date, current_date);
    end;
  else
    v_due := coalesce(p_due_date, current_date);
  end if;

  for r in
    select m.user_id
    from public.chama_members m
    where m.chama_id = p_chama_id
      and m.status = 'active'
      and m.role <> 'New Applicant'
      and (
        coalesce(v_plan.applies_to_all, true)
        or exists (
          select 1 from public.contribution_plan_members pm
          where pm.plan_id = p_plan_id and pm.member_id = m.user_id
        )
      )
  loop
    insert into public.contribution_obligations (
      chama_id, plan_id, member_id, period_key, due_date,
      expected_amount, paid_amount, status
    ) values (
      p_chama_id, p_plan_id, r.user_id, v_period, v_due,
      v_plan.amount, 0, 'pending'
    )
    on conflict (plan_id, member_id, period_key) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
  end loop;

  select count(*) into v_total
  from public.contribution_obligations
  where plan_id = p_plan_id and period_key = v_period;

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

-- Payment methods allow-list on constitution
create or replace function public.set_allowed_payment_methods(
  p_chama_id uuid,
  p_methods text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can set payment methods';
  end if;
  update public.chamas
  set constitution = constitution || jsonb_build_object(
    'allowedPaymentMethods', to_jsonb(coalesce(p_methods, array['Cash','M-Pesa','Bank','Other']))
  )
  where id = p_chama_id;
end;
$$;

grant execute on function public.set_allowed_payment_methods(uuid, text[]) to authenticated;

-- Spending policy: officials | member_quorum | leader_report
create or replace function public.set_spending_policy(
  p_chama_id uuid,
  p_policy text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials';
  end if;
  if p_policy not in ('officials', 'member_quorum', 'leader_report') then
    raise exception 'Invalid policy';
  end if;
  update public.chamas
  set constitution = constitution
    || jsonb_build_object('spendingPolicy', p_policy)
    || jsonb_build_object('welfareExpenseApproval',
         case when p_policy = 'leader_report' then 'officials' else p_policy end)
  where id = p_chama_id;
end;
$$;

grant execute on function public.set_spending_policy(uuid, text) to authenticated;

-- Group expenses with categories
create table if not exists public.group_expenses (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  category text not null default 'other',
  description text not null,
  amount numeric not null check (amount > 0),
  expense_date date not null default current_date,
  payment_method text,
  spent_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  status text not null default 'recorded'
    check (status in ('pending', 'approved', 'recorded', 'rejected')),
  kit_code text,
  welfare_bucket text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists group_expenses_chama_idx on public.group_expenses (chama_id, expense_date desc);
alter table public.group_expenses enable row level security;
drop policy if exists group_expenses_select on public.group_expenses;
create policy group_expenses_select on public.group_expenses
  for select to authenticated
  using (public.is_chama_member(chama_id));

create or replace function public.record_group_expense(
  p_chama_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_kit_code text default 'group-reserve',
  p_payment_method text default 'Other',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_policy text;
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can record group expenses';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select coalesce(constitution->>'spendingPolicy', 'officials') into v_policy
  from public.chamas where id = p_chama_id;

  -- Debit kit when recorded under officials / leader_report
  perform public.record_expense_from_kit(
    p_chama_id,
    coalesce(nullif(trim(p_kit_code), ''), 'group-reserve'),
    p_amount,
    coalesce(p_description, p_category),
    coalesce(p_payment_method, 'Other'),
    null
  );

  insert into public.group_expenses (
    chama_id, category, description, amount, payment_method,
    spent_by, approved_by, status, kit_code, notes
  ) values (
    p_chama_id,
    coalesce(nullif(trim(p_category), ''), 'other'),
    coalesce(p_description, 'Expense'),
    p_amount,
    p_payment_method,
    auth.uid(),
    auth.uid(),
    'recorded',
    coalesce(p_kit_code, 'group-reserve'),
    p_notes
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'policy', v_policy);
end;
$$;

grant execute on function public.record_group_expense(uuid, text, text, numeric, text, text, text) to authenticated;

-- Formal receipts
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  member_id uuid not null references auth.users (id),
  contribution_id uuid references public.contributions (id),
  obligation_id uuid references public.contribution_obligations (id),
  amount numeric not null,
  method text,
  reference text,
  description text,
  issued_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists payment_receipts_member_idx
  on public.payment_receipts (chama_id, member_id, created_at desc);

alter table public.payment_receipts enable row level security;
drop policy if exists receipts_select on public.payment_receipts;
create policy receipts_select on public.payment_receipts
  for select to authenticated
  using (member_id = auth.uid() or public.is_chama_member(chama_id));

create or replace function public.issue_receipt_for_contribution(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contributions%rowtype;
  v_id uuid;
begin
  select * into v_c from public.contributions where id = p_contribution_id;
  if not found then raise exception 'Contribution not found'; end if;
  if auth.uid() <> v_c.member_id and not public.is_chama_official(v_c.chama_id) then
    raise exception 'Not allowed';
  end if;

  insert into public.payment_receipts (
    chama_id, member_id, contribution_id, obligation_id,
    amount, method, reference, description, issued_by
  ) values (
    v_c.chama_id, v_c.member_id, v_c.id, v_c.obligation_id,
    v_c.amount, v_c.method, v_c.reference,
    format('Payment · %s', v_c.destination),
    auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'reference', v_c.reference,
    'amount', v_c.amount,
    'method', v_c.method,
    'date', v_c.created_at
  );
end;
$$;

grant execute on function public.issue_receipt_for_contribution(uuid) to authenticated;

-- Member statement
create or replace function public.member_financial_statement(
  p_chama_id uuid,
  p_member_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_member_id, auth.uid());
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if v_uid <> auth.uid() and not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can view other members statements';
  end if;

  return jsonb_build_object(
    'memberId', v_uid,
    'obligations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', o.due_date,
        'description', p.name || ' (' || o.period_key || ')',
        'expected', o.expected_amount,
        'paid', o.paid_amount,
        'balance', greatest(0, o.expected_amount - o.paid_amount),
        'status', o.status,
        'type', 'obligation'
      ) order by o.due_date nulls last, o.created_at)
      from public.contribution_obligations o
      join public.contribution_plans p on p.id = o.plan_id
      where o.chama_id = p_chama_id and o.member_id = v_uid
    ), '[]'::jsonb),
    'penalties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', pen.created_at,
        'description', coalesce(pen.reason, 'Penalty'),
        'expected', pen.amount,
        'paid', case when pen.status = 'paid' then pen.amount else 0 end,
        'balance', case when pen.status = 'assessed' then pen.amount else 0 end,
        'status', pen.status,
        'type', 'penalty'
      ) order by pen.created_at)
      from public.contribution_penalties pen
      where pen.chama_id = p_chama_id and pen.member_id = v_uid
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', c.created_at,
        'description', c.destination,
        'expected', c.amount,
        'paid', c.amount,
        'balance', 0,
        'status', c.status,
        'type', 'payment',
        'reference', c.reference
      ) order by c.created_at desc)
      from public.contributions c
      where c.chama_id = p_chama_id and c.member_id = v_uid
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'date', r.created_at,
        'amount', r.amount,
        'reference', r.reference,
        'method', r.method,
        'description', r.description
      ) order by r.created_at desc)
      from public.payment_receipts r
      where r.chama_id = p_chama_id and r.member_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.member_financial_statement(uuid, uuid) to authenticated;

-- Arrears report
create or replace function public.chama_arrears_report(p_chama_id uuid)
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
      'memberId', o.member_id,
      'planName', p.name,
      'periodKey', o.period_key,
      'dueDate', o.due_date,
      'expected', o.expected_amount,
      'paid', o.paid_amount,
      'outstanding', greatest(0, o.expected_amount - o.paid_amount),
      'status', o.status
    ) order by outstanding desc)
    from (
      select *, greatest(0, expected_amount - paid_amount) as outstanding
      from public.contribution_obligations
      where chama_id = p_chama_id and status in ('pending', 'partial')
    ) o
    join public.contribution_plans p on p.id = o.plan_id
    where o.outstanding > 0
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.chama_arrears_report(uuid) to authenticated;

-- Obligation-based dashboard summary
create or replace function public.chama_obligation_dashboard(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expected numeric;
  v_collected numeric;
  v_outstanding numeric;
  v_penalties numeric;
  v_waived numeric;
  v_expenses numeric;
begin
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;

  select
    coalesce(sum(expected_amount), 0),
    coalesce(sum(paid_amount), 0),
    coalesce(sum(greatest(0, expected_amount - paid_amount)), 0)
  into v_expected, v_collected, v_outstanding
  from public.contribution_obligations
  where chama_id = p_chama_id;

  select coalesce(sum(amount), 0) into v_penalties
  from public.contribution_penalties
  where chama_id = p_chama_id and status = 'assessed';

  select coalesce(sum(amount), 0) into v_waived
  from public.contribution_penalties
  where chama_id = p_chama_id and status = 'waived';

  select coalesce(sum(amount), 0) into v_expenses
  from public.group_expenses
  where chama_id = p_chama_id and status in ('recorded', 'approved');

  return jsonb_build_object(
    'expectedContributions', v_expected,
    'collectedContributions', v_collected,
    'outstandingContributions', v_outstanding,
    'penaltiesAssessed', v_penalties,
    'penaltiesWaived', v_waived,
    'groupExpenses', v_expenses,
    'activeMembers', (
      select count(*) from public.chama_members
      where chama_id = p_chama_id and status = 'active' and role <> 'New Applicant'
    )
  );
end;
$$;

grant execute on function public.chama_obligation_dashboard(uuid) to authenticated;

-- Assess penalties (callable manually or via scheduled edge function / cron)
-- Already have assess_overdue_penalties — add wrapper for "auto" naming
create or replace function public.run_scheduled_penalty_assessment(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.assess_overdue_penalties(p_chama_id);
end;
$$;

grant execute on function public.run_scheduled_penalty_assessment(uuid) to authenticated;
