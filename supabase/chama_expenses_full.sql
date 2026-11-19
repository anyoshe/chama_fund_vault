-- Chama expenses: full fields + list + debit kit
-- Run in Supabase SQL Editor

alter table public.group_expenses add column if not exists paid_to text;
alter table public.group_expenses add column if not exists reference text;
alter table public.group_expenses add column if not exists expense_type text default 'general';

create or replace function public.list_group_expenses(
  p_chama_id uuid,
  p_from date default null,
  p_to date default null
)
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
    select jsonb_agg(row_data order by expense_date desc, created_at desc)
    from (
      select jsonb_build_object(
        'id', e.id,
        'category', e.category,
        'expenseType', coalesce(e.expense_type, e.category),
        'description', e.description,
        'amount', e.amount,
        'expenseDate', e.expense_date,
        'paymentMethod', e.payment_method,
        'kitCode', e.kit_code,
        'paidTo', e.paid_to,
        'reference', e.reference,
        'status', e.status,
        'spentBy', e.spent_by,
        'notes', e.notes,
        'createdAt', e.created_at
      ) as row_data,
      e.expense_date,
      e.created_at
      from public.group_expenses e
      where e.chama_id = p_chama_id
        and (p_from is null or e.expense_date >= p_from)
        and (p_to is null or e.expense_date <= p_to)
    ) s
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_group_expenses(uuid, date, date) to authenticated;

create or replace function public.record_group_expense(
  p_chama_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_kit_code text default 'group-reserve',
  p_payment_method text default 'Other',
  p_notes text default null,
  p_paid_to text default null,
  p_reference text default null,
  p_expense_type text default null,
  p_expense_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_kit text;
  v_bal numeric;
begin
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can record group expenses';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  v_kit := coalesce(nullif(trim(p_kit_code), ''), 'group-reserve');

  select balance into v_bal
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = v_kit;

  if v_bal is null then
    perform public.ensure_chama_kits(p_chama_id);
    select balance into v_bal
    from public.chama_kits
    where chama_id = p_chama_id and kit_code = v_kit;
  end if;

  if coalesce(v_bal, 0) < p_amount then
    raise exception 'Kit "%" only has % — not enough for expense of %',
      v_kit, coalesce(v_bal, 0), p_amount;
  end if;

  -- Debit kit (existing helper)
  perform public.record_expense_from_kit(
    p_chama_id,
    v_kit,
    p_amount,
    coalesce(p_description, p_category, 'Expense'),
    coalesce(p_reference, p_payment_method, 'Expense'),
    null
  );

  insert into public.group_expenses (
    chama_id, category, expense_type, description, amount, expense_date,
    payment_method, spent_by, approved_by, status, kit_code, notes, paid_to, reference
  ) values (
    p_chama_id,
    coalesce(nullif(trim(p_category), ''), 'other'),
    coalesce(nullif(trim(p_expense_type), ''), nullif(trim(p_category), ''), 'general'),
    coalesce(p_description, 'Expense'),
    p_amount,
    coalesce(p_expense_date, current_date),
    p_payment_method,
    auth.uid(),
    auth.uid(),
    'recorded',
    v_kit,
    p_notes,
    p_paid_to,
    p_reference
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'kit', v_kit, 'amount', p_amount);
end;
$$;

-- Support both old 7-arg and new signature via defaults
grant execute on function public.record_group_expense(uuid, text, text, numeric, text, text, text, text, text, text, date) to authenticated;
