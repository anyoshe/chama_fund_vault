-- Reverse or move a contribution to another kit (same member, own rows only)
-- Run in Supabase SQL Editor

create or replace function public.reallocate_contribution(
  p_contribution_id uuid,
  p_new_destination text
)
returns public.contributions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contributions;
  v_old text;
  v_new text;
  v_amt numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row
  from public.contributions
  where id = p_contribution_id
  for update;

  if not found then
    raise exception 'Contribution not found';
  end if;

  if v_row.member_id <> auth.uid() then
    raise exception 'You can only correct your own contributions';
  end if;

  if v_row.status not in ('completed', 'complete', 'confirmed', 'paid', 'success') then
    raise exception 'Only completed contributions can be reallocated';
  end if;

  v_old := trim(v_row.destination);
  v_new := trim(p_new_destination);
  v_amt := v_row.amount;

  if v_new is null or v_new = '' then
    raise exception 'New kit is required';
  end if;

  if v_old = v_new then
    raise exception 'Already on that kit';
  end if;

  if not public.is_chama_member(v_row.chama_id) then
    raise exception 'Not a member of this chama';
  end if;

  perform public.ensure_chama_kits(v_row.chama_id);

  insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
  values (
    v_row.chama_id,
    v_new,
    public.kit_label(v_new),
    (v_new = 'member-loans'),
    public.kit_counts_toward_loan(v_new)
  )
  on conflict (chama_id, kit_code) do nothing;

  -- Move balances: debit old, credit new
  update public.chama_kits
  set balance = greatest(0, balance - v_amt)
  where chama_id = v_row.chama_id and kit_code = v_old;

  update public.chama_kits
  set balance = balance + v_amt
  where chama_id = v_row.chama_id and kit_code = v_new;

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (v_row.chama_id, auth.uid(), v_old, 0, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = greatest(0, public.member_kit_balances.balance - v_amt),
    updated_at = now();

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (v_row.chama_id, auth.uid(), v_new, v_amt, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = public.member_kit_balances.balance + v_amt,
    updated_at = now();

  update public.contributions
  set destination = v_new
  where id = p_contribution_id
  returning * into v_row;

  -- total_paid and pool_balance unchanged (same money, different kit)
  update public.chamas c
  set pool_balance = coalesce((
        select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
      ), 0)
  where c.id = v_row.chama_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_row.chama_id,
    auth.uid(),
    'contribution',
    format('Reallocated contribution from %s to %s', v_old, v_new),
    v_amt,
    v_row.reference
  );

  return v_row;
end;
$$;

grant execute on function public.reallocate_contribution(uuid, text) to authenticated;
