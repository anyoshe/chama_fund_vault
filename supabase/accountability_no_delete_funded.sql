-- ============================================================
-- Accountability: no delete of plans/kits once money has moved
-- - Unpaid obligations can still be cancelled
-- - Plans/kits with payments or balance: deactivate or edit only
-- ============================================================

-- Cancel unpaid obligation only (not paid/partial with money)
create or replace function public.cancel_unpaid_obligation(p_obligation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.contribution_obligations%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_o from public.contribution_obligations where id = p_obligation_id for update;
  if not found then raise exception 'Obligation not found'; end if;
  if not public.is_chama_official(v_o.chama_id) then
    raise exception 'Only officials can cancel obligations';
  end if;
  if v_o.paid_amount > 0 or v_o.status in ('paid', 'partial') then
    raise exception 'Cannot cancel obligation that has received money (paid_amount=%)', v_o.paid_amount;
  end if;

  update public.contribution_obligations
  set status = 'cancelled', updated_at = now()
  where id = p_obligation_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    v_o.chama_id, auth.uid(), 'contribution',
    format('Cancelled unpaid obligation %s', p_obligation_id),
    v_o.expected_amount
  );

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

grant execute on function public.cancel_unpaid_obligation(uuid) to authenticated;

-- Deactivate plan only if no money received on its obligations
create or replace function public.deactivate_contribution_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_paid numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into v_plan from public.contribution_plans where id = p_plan_id;
  if not found then raise exception 'Plan not found'; end if;
  if not public.is_chama_official(v_plan.chama_id) then
    raise exception 'Only officials can deactivate plans';
  end if;

  select coalesce(sum(paid_amount), 0) into v_paid
  from public.contribution_obligations where plan_id = p_plan_id;

  if v_paid > 0 then
    raise exception
      'This plan has already received money (KES %). For accountability it cannot be deleted. You may cancel unpaid obligations only.',
      v_paid;
  end if;

  -- Also block if contributions reference obligations of this plan
  if exists (
    select 1 from public.contributions c
    join public.contribution_obligations o on o.id = c.obligation_id
    where o.plan_id = p_plan_id
  ) then
    raise exception 'This plan is linked to recorded payments and cannot be deleted.';
  end if;

  -- Cancel unpaid obligations, deactivate plan (no hard delete)
  update public.contribution_obligations
  set status = 'cancelled', updated_at = now()
  where plan_id = p_plan_id and paid_amount = 0 and status in ('pending', 'partial');

  update public.contribution_plans
  set is_active = false, updated_at = now()
  where id = p_plan_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    v_plan.chama_id, auth.uid(), 'contribution',
    format('Deactivated plan "%s" (no money received)', v_plan.name),
    v_plan.amount
  );

  return jsonb_build_object('ok', true, 'planId', p_plan_id, 'active', false);
end;
$$;

grant execute on function public.deactivate_contribution_plan(uuid) to authenticated;

-- Replace hard delete: refuse if funded; otherwise soft-deactivate
create or replace function public.delete_contribution_plan(
  p_plan_id uuid,
  p_hard_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
  v_paid numeric;
begin
  select * into v_plan from public.contribution_plans where id = p_plan_id;
  if not found then raise exception 'Plan not found'; end if;
  if not public.is_chama_official(v_plan.chama_id) then
    raise exception 'Only officials can manage plans';
  end if;

  select coalesce(sum(paid_amount), 0) into v_paid
  from public.contribution_obligations where plan_id = p_plan_id;

  if v_paid > 0
     or exists (
       select 1 from public.contributions c
       join public.contribution_obligations o on o.id = c.obligation_id
       where o.plan_id = p_plan_id
     )
     or exists (
       select 1 from public.contributions c
       where c.chama_id = v_plan.chama_id
         and c.destination = v_plan.destination_kit
         and c.created_at >= v_plan.created_at
         and lower(c.payment_details) like '%' || lower(v_plan.name) || '%'
     )
  then
    raise exception
      'Accountability: plan "%" has received or is linked to money (paid KES %). Edit rules or cancel unpaid obligations only — no delete.',
      v_plan.name, v_paid;
  end if;

  -- Never hard-delete funded history; only soft deactivate when clean
  return public.deactivate_contribution_plan(p_plan_id);
end;
$$;

grant execute on function public.delete_contribution_plan(uuid, boolean) to authenticated;

-- Kits: never delete if balance > 0 or any contribution used this destination
create or replace function public.delete_chama_kit(
  p_chama_id uuid,
  p_kit_code text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kit text := trim(p_kit_code);
  v_bal numeric := 0;
  v_label text;
  v_contrib_count int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can manage kits';
  end if;
  if nullif(v_kit, '') is null then raise exception 'Kit code required'; end if;

  select balance, label into v_bal, v_label
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = v_kit;

  if not found then
    raise exception 'Kit "%" not found', v_kit;
  end if;

  -- Standard kits: never delete
  if v_kit in (
    'table-banking', 'share-capital', 'general-savings', 'member-loans',
    'merry-go-round', 'welfare', 'group-reserve', 'registration-fees',
    'contingency'
  ) then
    raise exception 'Standard kit "%" cannot be deleted. Move or spend funds via proper transactions.', v_kit;
  end if;

  select count(*) into v_contrib_count
  from public.contributions
  where chama_id = p_chama_id and destination = v_kit;

  if coalesce(v_bal, 0) > 0 or v_contrib_count > 0 then
    raise exception
      'Accountability: kit "%" has balance KES % and % contribution(s). Cannot delete. Transfer via reallocate/expense records instead.',
      coalesce(v_label, v_kit), coalesce(v_bal, 0), v_contrib_count;
  end if;

  -- Empty, never-funded custom kit: allowed to remove
  delete from public.member_kit_balances
  where chama_id = p_chama_id and kit_code = v_kit;

  delete from public.chama_kits
  where chama_id = p_chama_id and kit_code = v_kit;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'withdrawal',
    format('Removed empty unused kit "%s"', coalesce(v_label, v_kit)),
    0
  );

  return jsonb_build_object('ok', true, 'kitCode', v_kit, 'removed', true);
end;
$$;

grant execute on function public.delete_chama_kit(uuid, text, boolean) to authenticated;

-- Edit plan metadata only when needed (amount change does not erase history)
create or replace function public.edit_contribution_plan(
  p_plan_id uuid,
  p_name text default null,
  p_amount numeric default null,
  p_due_day int default null,
  p_description text default null,
  p_is_mandatory boolean default null,
  p_allow_partial boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.contribution_plans%rowtype;
begin
  select * into v_plan from public.contribution_plans where id = p_plan_id;
  if not found then raise exception 'Plan not found'; end if;
  if not public.is_chama_official(v_plan.chama_id) then
    raise exception 'Only officials can edit plans';
  end if;
  if not v_plan.is_active then
    raise exception 'Plan is inactive';
  end if;

  update public.contribution_plans set
    name = coalesce(nullif(trim(p_name), ''), name),
    amount = case when p_amount is not null and p_amount > 0 then p_amount else amount end,
    due_day = coalesce(p_due_day, due_day),
    description = coalesce(p_description, description),
    is_mandatory = coalesce(p_is_mandatory, is_mandatory),
    allow_partial = coalesce(p_allow_partial, allow_partial),
    updated_at = now()
  where id = p_plan_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    v_plan.chama_id, auth.uid(), 'contribution',
    format('Edited plan "%s"', coalesce(nullif(trim(p_name), ''), v_plan.name)),
    coalesce(p_amount, v_plan.amount)
  );

  return jsonb_build_object('ok', true, 'planId', p_plan_id);
end;
$$;

grant execute on function public.edit_contribution_plan(uuid, text, numeric, int, text, boolean, boolean) to authenticated;

-- Disable bulk hard delete of all plans
create or replace function public.delete_all_contribution_plans(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception
    'Bulk delete is disabled for accountability. Deactivate individual plans with no money, or cancel unpaid obligations only.';
end;
$$;

grant execute on function public.delete_all_contribution_plans(uuid) to authenticated;
