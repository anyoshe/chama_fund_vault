-- Track periodic dues from join date + late fines under welfare-fines (sub of welfare)

-- Ensure fines destination is treated as welfare family
-- (UI maps welfare-fines → Welfare fines)

create table if not exists public.member_penalties (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  obligation_id uuid references public.contribution_obligations (id) on delete set null,
  amount numeric not null check (amount > 0),
  reason text,
  status text not null default 'open' check (status in ('open', 'paid', 'waived')),
  paid_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (obligation_id) -- one late fine per obligation
);

create index if not exists member_penalties_member_idx
  on public.member_penalties (chama_id, member_id, status);

alter table public.member_penalties enable row level security;

drop policy if exists member_penalties_select on public.member_penalties;
create policy member_penalties_select on public.member_penalties
  for select to authenticated
  using (
    member_id = auth.uid()
    or public.is_chama_official(chama_id)
  );

-- Generate all missing periods from each member's join month up to current period
create or replace function public.backfill_obligations_from_join(
  p_chama_id uuid,
  p_plan_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_mem record;
  v_cursor date;
  v_end date := date_trunc('month', current_date)::date;
  v_period text;
  v_due date;
  v_created int := 0;
  v_plans int := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can backfill dues history';
  end if;

  for v_plan in
    select * from public.contribution_plans
    where chama_id = p_chama_id
      and is_active
      and (p_plan_id is null or id = p_plan_id)
      and frequency in ('weekly', 'monthly', 'quarterly', 'annually', 'one_off')
  loop
    v_plans := v_plans + 1;

    for v_mem in
      select m.user_id, coalesce(m.joined_at, m.created_at, now())::date as joined
      from public.chama_members m
      where m.chama_id = p_chama_id
        and m.status = 'active'
        and m.role <> 'New Applicant'
    loop
      if v_plan.frequency = 'one_off' then
        v_period := 'once';
        v_due := v_mem.joined;
        insert into public.contribution_obligations (
          chama_id, plan_id, member_id, period_key, due_date, expected_amount, paid_amount, status
        ) values (
          p_chama_id, v_plan.id, v_mem.user_id, v_period, v_due, v_plan.amount, 0, 'pending'
        )
        on conflict (plan_id, member_id, period_key) do nothing;
        if found then v_created := v_created + 1; end if;
        continue;
      end if;

      -- monthly (and treat weekly/quarterly/annually as month buckets for simplicity)
      v_cursor := date_trunc('month', v_mem.joined)::date;
      while v_cursor <= v_end loop
        v_period := to_char(v_cursor, 'YYYY-MM');
        v_due := make_date(
          extract(year from v_cursor)::int,
          extract(month from v_cursor)::int,
          least(coalesce(v_plan.due_day, 5), 28)
        );
        insert into public.contribution_obligations (
          chama_id, plan_id, member_id, period_key, due_date, expected_amount, paid_amount, status
        ) values (
          p_chama_id, v_plan.id, v_mem.user_id, v_period, v_due, v_plan.amount, 0, 'pending'
        )
        on conflict (plan_id, member_id, period_key) do nothing;
        get diagnostics v_created = row_count; -- not additive correctly; use counter
        v_cursor := (v_cursor + interval '1 month')::date;
      end loop;
    end loop;
  end loop;

  select count(*) into v_created
  from public.contribution_obligations o
  where o.chama_id = p_chama_id
    and o.status in ('pending', 'partial');

  return jsonb_build_object(
    'plansProcessed', v_plans,
    'openObligations', v_created,
    'message', 'Dues generated from each member join date through this month'
  );
end;
$$;

grant execute on function public.backfill_obligations_from_join(uuid, uuid) to authenticated;

-- Assess late fines for overdue unpaid obligations (constitution lateFineRate %)
create or replace function public.assess_late_fines_for_chama(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
  r record;
  v_fine numeric;
  v_count int := 0;
  v_total numeric := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can assess late fines';
  end if;

  select coalesce((constitution->>'lateFineRate')::numeric, 0)
  into v_rate
  from public.chamas where id = p_chama_id;

  if v_rate is null or v_rate <= 0 then
    return jsonb_build_object('assessed', 0, 'message', 'lateFineRate is 0 — no fines');
  end if;

  for r in
    select o.id, o.member_id, o.expected_amount, o.paid_amount, o.due_date
    from public.contribution_obligations o
    where o.chama_id = p_chama_id
      and o.status in ('pending', 'partial', 'overdue')
      and o.due_date < current_date
      and (o.expected_amount - coalesce(o.paid_amount, 0)) > 0
  loop
    v_fine := round(((r.expected_amount - coalesce(r.paid_amount, 0)) * v_rate / 100.0)::numeric, 2);
    if v_fine < 1 then continue; end if;

    insert into public.member_penalties (
      chama_id, member_id, obligation_id, amount, reason, status
    ) values (
      p_chama_id, r.member_id, r.id, v_fine,
      format('Late fine %s%% on overdue contribution due %s', v_rate, r.due_date),
      'open'
    )
    on conflict (obligation_id) do nothing;

    if found then
      v_count := v_count + 1;
      v_total := v_total + v_fine;
      update public.contribution_obligations
      set status = 'overdue'
      where id = r.id and status in ('pending', 'partial');
    end if;
  end loop;

  return jsonb_build_object('assessed', v_count, 'totalFines', v_total, 'rate', v_rate);
end;
$$;

grant execute on function public.assess_late_fines_for_chama(uuid) to authenticated;

-- Member-facing: obligations + open fines + totals
create or replace function public.list_my_payment_dues(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_obs jsonb;
  v_fines jsonb;
  v_principal numeric;
  v_fine_total numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.due_date), '[]'::jsonb)
  into v_obs
  from (
    select
      o.id,
      o.plan_id as "planId",
      p.name as "planName",
      p.frequency,
      p.destination_kit as "destinationKit",
      o.period_key as "periodKey",
      o.due_date as "dueDate",
      o.expected_amount as "expectedAmount",
      o.paid_amount as "paidAmount",
      greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0) as outstanding,
      o.status,
      (o.due_date < current_date and greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0) > 0) as "isBehind"
    from public.contribution_obligations o
    join public.contribution_plans p on p.id = o.plan_id
    where o.chama_id = p_chama_id
      and o.member_id = auth.uid()
      and o.status in ('pending', 'partial', 'overdue')
      and greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0) > 0
  ) x;

  select coalesce(jsonb_agg(row_to_json(f)::jsonb), '[]'::jsonb)
  into v_fines
  from (
    select
      id,
      amount,
      greatest(amount - coalesce(paid_amount, 0), 0) as outstanding,
      reason,
      obligation_id as "obligationId",
      status,
      'welfare-fines' as "destinationKit"
    from public.member_penalties
    where chama_id = p_chama_id
      and member_id = auth.uid()
      and status = 'open'
      and greatest(amount - coalesce(paid_amount, 0), 0) > 0
  ) f;

  select coalesce(sum((e->>'outstanding')::numeric), 0) into v_principal from jsonb_array_elements(v_obs) e;
  select coalesce(sum((e->>'outstanding')::numeric), 0) into v_fine_total from jsonb_array_elements(v_fines) e;

  return jsonb_build_object(
    'obligations', v_obs,
    'fines', v_fines,
    'principalBehind', v_principal,
    'finesOutstanding', v_fine_total,
    'totalToPay', v_principal + v_fine_total
  );
end;
$$;

grant execute on function public.list_my_payment_dues(uuid) to authenticated;

-- Pay a fine → credits welfare-fines (under welfare family)
create or replace function public.pay_member_penalty(
  p_penalty_id uuid,
  p_amount numeric,
  p_method text default 'Other',
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.member_penalties%rowtype;
  v_pay numeric;
  v_ref text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_p from public.member_penalties where id = p_penalty_id;
  if not found then raise exception 'Fine not found'; end if;
  if v_p.member_id <> auth.uid() and not public.is_chama_official(v_p.chama_id) then
    raise exception 'Not allowed';
  end if;
  if v_p.status <> 'open' then raise exception 'Fine is not open'; end if;

  v_pay := least(p_amount, v_p.amount - coalesce(v_p.paid_amount, 0));
  if v_pay <= 0 then raise exception 'Nothing to pay'; end if;

  v_ref := coalesce(nullif(trim(p_reference), ''), 'FINE-' || substr(gen_random_uuid()::text, 1, 8));

  -- credit welfare-fines kit
  insert into public.kits (chama_id, kit_code, label, balance)
  values (v_p.chama_id, 'welfare-fines', 'Welfare · fines', v_pay)
  on conflict (chama_id, kit_code) do update
    set balance = public.kits.balance + excluded.balance;

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance)
  values (v_p.chama_id, v_p.member_id, 'welfare-fines', v_pay)
  on conflict (chama_id, user_id, kit_code) do update
    set balance = public.member_kit_balances.balance + excluded.balance;

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, reference, status, created_by
  ) values (
    v_p.chama_id, v_p.member_id, v_pay, 'welfare-fines',
    coalesce(nullif(trim(p_method), ''), 'Other'),
    v_ref, 'completed', auth.uid()
  );

  update public.member_penalties
  set paid_amount = coalesce(paid_amount, 0) + v_pay,
      status = case when coalesce(paid_amount, 0) + v_pay >= amount then 'paid' else 'open' end
  where id = p_penalty_id;

  return jsonb_build_object('ok', true, 'paid', v_pay, 'destinationKit', 'welfare-fines');
end;
$$;

grant execute on function public.pay_member_penalty(uuid, numeric, text, text) to authenticated;
