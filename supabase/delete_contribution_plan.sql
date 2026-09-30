-- Delete a contribution plan and its related data (officials only).
-- Does NOT delete contribution payment rows (audit history stays).
-- Unlinks contributions.obligation_id so payments remain.

create or replace function public.delete_contribution_plan(
  p_plan_id uuid,
  p_hard_delete boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_obl int;
  v_pen int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_plan from public.contribution_plans where id = p_plan_id;
  if not found then raise exception 'Plan not found'; end if;
  if not public.is_chama_official(v_plan.chama_id) then
    raise exception 'Only Chairperson, Treasurer or Secretary can delete plans';
  end if;

  -- Unlink payments from obligations (keep contribution history)
  update public.contributions c
  set obligation_id = null
  where c.obligation_id in (
    select o.id from public.contribution_obligations o where o.plan_id = p_plan_id
  );

  -- Penalties on those obligations
  delete from public.contribution_penalties pen
  where pen.obligation_id in (
    select o.id from public.contribution_obligations o where o.plan_id = p_plan_id
  );
  get diagnostics v_pen = row_count;

  delete from public.contribution_obligations where plan_id = p_plan_id;
  get diagnostics v_obl = row_count;

  delete from public.contribution_plan_members where plan_id = p_plan_id;

  -- Clear welfare event link if any (keep event row)
  update public.welfare_events set plan_id = null where plan_id = p_plan_id;

  if coalesce(p_hard_delete, true) then
    delete from public.contribution_plans where id = p_plan_id;
  else
    update public.contribution_plans
    set is_active = false, updated_at = now()
    where id = p_plan_id;
  end if;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    v_plan.chama_id, auth.uid(), 'contribution',
    format('Deleted plan "%s" · %s obligations · %s penalties',
      v_plan.name, v_obl, v_pen),
    v_plan.amount
  );

  return jsonb_build_object(
    'ok', true,
    'planId', p_plan_id,
    'planName', v_plan.name,
    'obligationsRemoved', v_obl,
    'penaltiesRemoved', v_pen,
    'hardDelete', coalesce(p_hard_delete, true)
  );
end;
$$;

grant execute on function public.delete_contribution_plan(uuid, boolean) to authenticated;

-- Optional: wipe ALL plans for a chama (use carefully)
create or replace function public.delete_all_contribution_plans(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can delete plans';
  end if;

  for r in select id from public.contribution_plans where chama_id = p_chama_id
  loop
    perform public.delete_contribution_plan(r.id, true);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('deletedPlans', v_n);
end;
$$;

grant execute on function public.delete_all_contribution_plans(uuid) to authenticated;
