-- Ensure detector exists
create or replace function public.is_retired_welfare_expense_kit(p_code text, p_label text default null)
returns boolean
language sql
immutable
as $$
  select (
    lower(coalesce(p_code, '')) ~ 'welfare.*(run|expens)'
    or lower(coalesce(p_code, '')) ~ 'run.*expens'
    or lower(coalesce(p_label, '')) ~ 'welfare.*(run|expens)'
    or lower(coalesce(p_label, '')) ~ 'run.*expens'
    or lower(coalesce(p_code, '')) like '%running%expense%'
    or lower(coalesce(p_label, '')) like '%running%expense%'
    or lower(coalesce(p_code, '')) like '%accoutn%'
    or lower(coalesce(p_label, '')) like '%accoutn%'
  )
  and lower(coalesce(p_code, '')) <> 'welfare';
$$;

-- Point any plan still using "Welfare running expenses…" at welfare
-- Run in Supabase SQL Editor

-- Normalize plan destinations
update public.contribution_plans p
set destination_kit = 'welfare'
where public.is_retired_welfare_expense_kit(p.destination_kit, p.destination_kit)
   or lower(p.destination_kit) like '%run%expens%'
   or lower(p.destination_kit) like '%welfare%run%'
   or lower(p.name) like '%running expense%';

-- Also fix free-text destinations that are not exact kit codes
update public.contribution_plans
set destination_kit = 'welfare'
where lower(replace(destination_kit, '_', ' ')) like '%welfare%running%'
   or lower(replace(destination_kit, '-', ' ')) like '%welfare%running%'
   or lower(destination_kit) like '%accoutn%'  -- common typo in kit name
   or lower(destination_kit) like '%running expenses%';

-- Show what plans look like now
select c.name as chama, p.name as plan, p.destination_kit, p.amount, p.is_active
from public.contribution_plans p
join public.chamas c on c.id = p.chama_id
order by c.name, p.name;

-- list_my_obligations: always return normalized kit
create or replace function public.list_my_obligations(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.due_sort nulls last, x.plan_name)
    from (
      select
        o.id,
        o.plan_id as "planId",
        p.name as "planName",
        case
          when public.is_retired_welfare_expense_kit(p.destination_kit, p.destination_kit)
            then 'welfare'
          when lower(p.destination_kit) like '%run%expens%'
            or lower(p.destination_kit) like '%running expense%'
            then 'welfare'
          when lower(p.destination_kit) in ('registration', 'reg-fees')
            then 'registration-fees'
          else p.destination_kit
        end as "destinationKit",
        p.frequency,
        o.period_key as "periodKey",
        o.due_date as "dueDate",
        o.expected_amount as "expectedAmount",
        o.paid_amount as "paidAmount",
        greatest(0, o.expected_amount - o.paid_amount) as outstanding,
        o.status,
        p.allow_partial as "allowPartial",
        o.due_date as due_sort,
        p.name as plan_name
      from public.contribution_obligations o
      join public.contribution_plans p on p.id = o.plan_id
      where o.chama_id = p_chama_id
        and o.member_id = auth.uid()
        and o.status in ('pending', 'partial')
    ) x
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_my_obligations(uuid) to authenticated;
