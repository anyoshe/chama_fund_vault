-- Per-pot schedule: one_off | weekly (weekday) | monthly (date) + grace on deadline

alter table public.contribution_plans
  add column if not exists due_weekday int
  check (due_weekday is null or (due_weekday >= 0 and due_weekday <= 6));
-- 0 = Sunday … 6 = Saturday (Postgres extract(dow))

comment on column public.contribution_plans.due_day is 'Day of month 1-28 for monthly plans';
comment on column public.contribution_plans.due_weekday is '0=Sun..6=Sat for weekly plans';

-- Compute due date for a period key
create or replace function public.compute_plan_due_date(
  p_frequency text,
  p_due_day int,
  p_due_weekday int,
  p_period_key text,
  p_ref date default current_date
)
returns date
language plpgsql
immutable
as $$
declare
  v_y int;
  v_m int;
  v_d date;
  v_dow int;
  v_target int;
begin
  if p_frequency = 'one_off' then
    return p_ref;
  end if;

  if p_frequency = 'monthly' then
    -- period_key YYYY-MM
    begin
      v_y := split_part(p_period_key, '-', 1)::int;
      v_m := split_part(p_period_key, '-', 2)::int;
    exception when others then
      v_y := extract(year from p_ref)::int;
      v_m := extract(month from p_ref)::int;
    end;
    return make_date(v_y, v_m, least(coalesce(p_due_day, 5), 28));
  end if;

  if p_frequency = 'weekly' then
    -- period_key IYYY-WNN or use ref week; due = that week's weekday
    v_d := date_trunc('week', p_ref)::date; -- Monday start in Postgres date_trunc week
    -- Postgres: date_trunc('week') is Monday. dow: 0 Sun .. 6 Sat
    v_target := coalesce(p_due_weekday, 1); -- default Monday
    -- Find day in current week matching dow
    for i in 0..6 loop
      if extract(dow from (p_ref - i))::int = v_target then
        return p_ref - i;
      end if;
    end loop;
    -- forward
    for i in 0..6 loop
      if extract(dow from (p_ref + i))::int = v_target then
        return p_ref + i;
      end if;
    end loop;
    return p_ref;
  end if;

  if p_frequency = 'quarterly' then
    return date_trunc('quarter', p_ref)::date + (least(coalesce(p_due_day, 5), 28) - 1);
  end if;

  if p_frequency = 'annually' then
    return make_date(extract(year from p_ref)::int, 1, least(coalesce(p_due_day, 5), 28));
  end if;

  return p_ref;
end;
$$;

-- Fine start date = due_date + grace days
create or replace function public.obligation_fine_starts_on(
  p_due_date date,
  p_chama_id uuid
)
returns date
language sql
stable
as $$
  select p_due_date + coalesce(
    (select (constitution->>'lateFineGraceDays')::int from public.chamas where id = p_chama_id),
    0
  );
$$;

-- Upsert plan with due_weekday
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
  p_plan_id uuid default null,
  p_due_weekday int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_freq text := coalesce(nullif(trim(p_frequency), ''), 'monthly');
  v_due_day int;
  v_due_wd int;
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

  if v_freq = 'monthly' or v_freq = 'quarterly' or v_freq = 'annually' then
    v_due_day := least(28, greatest(1, coalesce(p_due_day, 5)));
    v_due_wd := null;
  elsif v_freq = 'weekly' then
    v_due_day := null;
    v_due_wd := least(6, greatest(0, coalesce(p_due_weekday, 1)));
  else
    v_due_day := null;
    v_due_wd := null;
  end if;

  if p_plan_id is not null then
    update public.contribution_plans set
      name = trim(p_name),
      description = p_description,
      amount = p_amount,
      frequency = v_freq,
      destination_kit = coalesce(nullif(trim(p_destination_kit), ''), 'general-savings'),
      due_day = v_due_day,
      due_weekday = v_due_wd,
      is_mandatory = coalesce(p_is_mandatory, true),
      allow_partial = coalesce(p_allow_partial, false),
      updated_at = now()
    where id = p_plan_id and chama_id = p_chama_id
    returning id into v_id;
    if v_id is null then raise exception 'Plan not found'; end if;
  else
    insert into public.contribution_plans (
      chama_id, name, description, amount, frequency, destination_kit,
      due_day, due_weekday, is_mandatory, allow_partial, created_by
    ) values (
      p_chama_id, trim(p_name), p_description, p_amount, v_freq,
      coalesce(nullif(trim(p_destination_kit), ''), 'general-savings'),
      v_due_day, v_due_wd,
      coalesce(p_is_mandatory, true),
      coalesce(p_allow_partial, false),
      auth.uid()
    )
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'name', trim(p_name),
    'frequency', v_freq,
    'dueDay', v_due_day,
    'dueWeekday', v_due_wd
  );
end;
$$;

grant execute on function public.upsert_contribution_plan(uuid, text, numeric, text, text, int, boolean, boolean, text, uuid, int) to authenticated;

-- Refresh ensure_current_period_obligations with correct due dates
create or replace function public.ensure_current_period_obligations(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_period text;
  v_due date;
  v_created int := 0;
  v_plans int := 0;
  r record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;

  for v_plan in
    select * from public.contribution_plans
    where chama_id = p_chama_id
      and is_active
      and frequency in ('weekly', 'monthly', 'quarterly', 'annually', 'one_off')
  loop
    v_plans := v_plans + 1;

    if v_plan.frequency = 'one_off' then
      v_period := 'once';
      v_due := coalesce(v_plan.starts_on, current_date);
    elsif v_plan.frequency = 'weekly' then
      v_period := to_char(current_date, 'IYYY') || '-W' || to_char(current_date, 'IW');
      v_due := public.compute_plan_due_date('weekly', null, v_plan.due_weekday, v_period, current_date);
    elsif v_plan.frequency = 'monthly' then
      v_period := to_char(current_date, 'YYYY-MM');
      v_due := public.compute_plan_due_date('monthly', v_plan.due_day, null, v_period, current_date);
    elsif v_plan.frequency = 'quarterly' then
      v_period := to_char(current_date, 'YYYY') || '-Q' || to_char(current_date, 'Q');
      v_due := public.compute_plan_due_date('quarterly', v_plan.due_day, null, v_period, current_date);
    else
      v_period := to_char(current_date, 'YYYY');
      v_due := public.compute_plan_due_date('annually', v_plan.due_day, null, v_period, current_date);
    end if;

    for r in
      select m.user_id
      from public.chama_members m
      where m.chama_id = p_chama_id
        and m.status = 'active'
        and coalesce(m.role, '') <> 'New Applicant'
    loop
      insert into public.contribution_obligations (
        chama_id, plan_id, member_id, period_key, due_date, expected_amount, paid_amount, status
      ) values (
        p_chama_id, v_plan.id, r.user_id, v_period, v_due, v_plan.amount, 0, 'pending'
      )
      on conflict (plan_id, member_id, period_key) do update
        set due_date = excluded.due_date,
            expected_amount = excluded.expected_amount,
            updated_at = now()
        where public.contribution_obligations.status in ('pending', 'partial', 'overdue');
      if found then
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'plans', v_plans,
    'period', to_char(current_date, 'YYYY-MM'),
    'ok', true
  );
end;
$$;

grant execute on function public.ensure_current_period_obligations(uuid) to authenticated;

-- Assess fines: only after due_date + grace (fine_starts_on)
create or replace function public.assess_late_fines_for_chama(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
  v_grace int;
  r record;
  v_fine numeric;
  v_count int := 0;
  v_total numeric := 0;
  v_fine_start date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can assess late fines';
  end if;

  select
    coalesce((constitution->>'lateFineRate')::numeric, 0),
    coalesce((constitution->>'lateFineGraceDays')::int, 0)
  into v_rate, v_grace
  from public.chamas where id = p_chama_id;

  if v_rate is null or v_rate <= 0 then
    return jsonb_build_object('assessed', 0, 'message', 'lateFineRate is 0 — set in Settings');
  end if;

  for r in
    select o.id, o.member_id, o.expected_amount, o.paid_amount, o.due_date
    from public.contribution_obligations o
    where o.chama_id = p_chama_id
      and o.status in ('pending', 'partial', 'overdue')
      and o.due_date is not null
      and (o.due_date + v_grace) < current_date
      and (o.expected_amount - coalesce(o.paid_amount, 0)) > 0
  loop
    v_fine_start := r.due_date + v_grace;
    v_fine := round(((r.expected_amount - coalesce(r.paid_amount, 0)) * v_rate / 100.0)::numeric, 2);
    if v_fine < 1 then continue; end if;

    insert into public.member_penalties (
      chama_id, member_id, obligation_id, amount, reason, status
    ) values (
      p_chama_id, r.member_id, r.id, v_fine,
      format(
        'Late fine %s percent · due %s · grace %s days · fines from %s',
        v_rate, r.due_date, v_grace, v_fine_start
      ),
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

  return jsonb_build_object(
    'assessed', v_count,
    'totalFines', v_total,
    'rate', v_rate,
    'graceDays', v_grace
  );
end;
$$;

grant execute on function public.assess_late_fines_for_chama(uuid) to authenticated;

-- Late list: expose dueDate + fineStartsOn
create or replace function public.list_late_members_for_treasurer(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_grace int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can view the late list';
  end if;

  select coalesce((constitution->>'lateFineGraceDays')::int, 0)
  into v_grace
  from public.chamas where id = p_chama_id;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.principalBehind desc, x.name)
    from (
      select
        m.user_id as "memberId",
        coalesce(p.full_name, 'Member') as name,
        coalesce(p.phone, '') as phone,
        m.role,
        coalesce((
          select sum(greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0))
          from public.contribution_obligations o
          where o.chama_id = p_chama_id
            and o.member_id = m.user_id
            and o.status in ('pending', 'partial', 'overdue')
            and o.due_date is not null
            and (o.due_date + v_grace) < current_date
            and greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0) > 0
        ), 0) as "principalBehind",
        coalesce((
          select sum(greatest(pen.amount - coalesce(pen.paid_amount, 0), 0))
          from public.member_penalties pen
          where pen.chama_id = p_chama_id
            and pen.member_id = m.user_id
            and pen.status = 'open'
        ), 0) as "finesOutstanding",
        (
          select coalesce(jsonb_agg(jsonb_build_object(
            'planName', pl.name,
            'periodKey', o.period_key,
            'dueDate', o.due_date,
            'fineStartsOn', o.due_date + v_grace,
            'outstanding', greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0)
          ) order by o.due_date), '[]'::jsonb)
          from public.contribution_obligations o
          join public.contribution_plans pl on pl.id = o.plan_id
          where o.chama_id = p_chama_id
            and o.member_id = m.user_id
            and o.status in ('pending', 'partial', 'overdue')
            and o.due_date is not null
            and (o.due_date + v_grace) < current_date
            and greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0) > 0
        ) as "lateItems"
      from public.chama_members m
      left join public.profiles p on p.id = m.user_id
      where m.chama_id = p_chama_id
        and m.status = 'active'
        and coalesce(m.role, '') <> 'New Applicant'
    ) x
    where x."principalBehind" > 0 or x."finesOutstanding" > 0
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_late_members_for_treasurer(uuid) to authenticated;
