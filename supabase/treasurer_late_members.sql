-- Treasurer: members late on periodic dues + open fines + phone for WhatsApp

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
            and o.due_date + v_grace < current_date
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
            'outstanding', greatest(o.expected_amount - coalesce(o.paid_amount, 0), 0)
          ) order by o.due_date), '[]'::jsonb)
          from public.contribution_obligations o
          join public.contribution_plans pl on pl.id = o.plan_id
          where o.chama_id = p_chama_id
            and o.member_id = m.user_id
            and o.status in ('pending', 'partial', 'overdue')
            and o.due_date + v_grace < current_date
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
