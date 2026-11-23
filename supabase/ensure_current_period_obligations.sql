-- Any member can ensure current period dues exist (idempotent; no official needed)

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
      and frequency in ('weekly', 'monthly', 'quarterly', 'annually')
  loop
    v_plans := v_plans + 1;

    if v_plan.frequency = 'weekly' then
      v_period := to_char(current_date, 'IYYY') || '-W' || to_char(current_date, 'IW');
      v_due := current_date + ((7 - extract(dow from current_date)::int) % 7);
    elsif v_plan.frequency = 'quarterly' then
      v_period := to_char(current_date, 'YYYY') || '-Q' || to_char(current_date, 'Q');
      v_due := date_trunc('quarter', current_date)::date + 14;
    elsif v_plan.frequency = 'annually' then
      v_period := to_char(current_date, 'YYYY');
      v_due := make_date(extract(year from current_date)::int, 1, least(coalesce(v_plan.due_day, 5), 28));
    else
      -- monthly default
      v_period := to_char(current_date, 'YYYY-MM');
      v_due := make_date(
        extract(year from current_date)::int,
        extract(month from current_date)::int,
        least(coalesce(v_plan.due_day, 5), 28)
      );
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
      on conflict (plan_id, member_id, period_key) do nothing;
      if found then
        v_created := v_created + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'plans', v_plans,
    'period', to_char(current_date, 'YYYY-MM'),
    'rowsTouched', v_created,
    'ok', true
  );
end;
$$;

grant execute on function public.ensure_current_period_obligations(uuid) to authenticated;
