-- Merge "Welfare Running Expenses" (and similar) into standard welfare kit
-- for ALL chamas, then delete those kits.
-- Run once in Supabase SQL Editor (as project owner / service role).

-- 1) Helper: detect mistaken welfare-expense kits
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
    or lower(coalesce(p_code, '')) in (
      'welfare-running-expenses',
      'welfare-running-expenses-account',
      'welfare_running_expenses',
      'welfare-running-expenses-accoutn'
    )
  )
  and lower(coalesce(p_code, '')) <> 'welfare';
$$;

-- 2) Merge + delete for every matching kit
do $$
declare
  r record;
  v_moved numeric;
  v_mb record;
begin
  for r in
    select k.chama_id, k.kit_code, k.label, coalesce(k.balance, 0) as balance
    from public.chama_kits k
    where public.is_retired_welfare_expense_kit(k.kit_code, k.label)
  loop
    -- Ensure welfare kit exists
    insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
    values (
      r.chama_id,
      'welfare',
      coalesce(public.kit_label('welfare'), 'Welfare / emergency'),
      0,
      false,
      false
    )
    on conflict (chama_id, kit_code) do nothing;

    -- Move kit balance → welfare
    if r.balance <> 0 then
      update public.chama_kits
      set balance = coalesce(balance, 0) + r.balance
      where chama_id = r.chama_id and kit_code = 'welfare';
    end if;

    -- Move member balances → welfare
    for v_mb in
      select user_id, balance
      from public.member_kit_balances
      where chama_id = r.chama_id and kit_code = r.kit_code and coalesce(balance, 0) <> 0
    loop
      insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
      values (r.chama_id, v_mb.user_id, 'welfare', v_mb.balance, now())
      on conflict (chama_id, user_id, kit_code) do update set
        balance = public.member_kit_balances.balance + excluded.balance,
        updated_at = now();
    end loop;

    delete from public.member_kit_balances
    where chama_id = r.chama_id and kit_code = r.kit_code;

    delete from public.chama_kits
    where chama_id = r.chama_id and kit_code = r.kit_code;

    -- Redirect historical contributions destination (optional readability)
    update public.contributions
    set destination = 'welfare',
        payment_details = trim(both ' ' from coalesce(payment_details, '') ||
          case when coalesce(payment_details, '') = '' then '' else ' | ' end ||
          'merged from kit ' || r.kit_code)
    where chama_id = r.chama_id
      and destination = r.kit_code;

    update public.chamas
    set pool_balance = coalesce((
      select sum(balance) from public.chama_kits where chama_id = r.chama_id
    ), 0)
    where id = r.chama_id;

    insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
    values (
      r.chama_id,
      null,
      'contribution',
      format(
        'Merged kit "%s" (%s) into welfare · Ksh %s moved · kit retired',
        coalesce(r.label, r.kit_code),
        r.kit_code,
        r.balance
      ),
      r.balance,
      'MERGE-WELFARE-EXP-' || r.kit_code
    );

    raise notice 'Merged % on chama % amount %', r.kit_code, r.chama_id, r.balance;
  end loop;
end;
$$;

-- 3) Map future payments that still use old names → welfare
create or replace function public.normalize_kit_destination(p_destination text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(trim(coalesce(p_destination, '')));
begin
  if v = '' then return 'general-savings'; end if;
  if public.is_retired_welfare_expense_kit(v, v) then
    return 'welfare';
  end if;
  return trim(p_destination);
end;
$$;

grant execute on function public.is_retired_welfare_expense_kit(text, text) to authenticated;
grant execute on function public.normalize_kit_destination(text) to authenticated;

-- Report remaining (should be empty)
select chama_id, kit_code, label, balance
from public.chama_kits
where public.is_retired_welfare_expense_kit(kit_code, label);
