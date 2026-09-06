-- Fix: column reference "active_loans" is ambiguous
-- RETURNS TABLE(active_loans int) clashed with chama_members.active_loans

create or replace function public.get_member_loan_limit(p_chama_id uuid, p_user_id uuid default auth.uid())
returns table (
  share_balance numeric,
  max_multiple numeric,
  max_loan numeric,
  loan_fund_balance numeric,
  active_loans int
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_shares numeric;
  v_mult numeric;
  v_fund numeric;
  v_loans int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_user_id is distinct from auth.uid() and not public.is_chama_member(p_chama_id) then
    raise exception 'Not allowed';
  end if;

  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_user_id
    and k.counts_toward_loan_limit = true;

  select coalesce((c.constitution->>'maxLoanMultiple')::numeric, 3) into v_mult
  from public.chamas c
  where c.id = p_chama_id;

  select coalesce(k.balance, 0) into v_fund
  from public.chama_kits k
  where k.chama_id = p_chama_id and k.kit_code = 'member-loans';

  select coalesce(m.active_loans, 0) into v_loans
  from public.chama_members m
  where m.chama_id = p_chama_id
    and m.user_id = p_user_id
    and m.status = 'active';

  share_balance := coalesce(v_shares, 0);
  max_multiple := coalesce(v_mult, 3);
  max_loan := coalesce(v_shares, 0) * coalesce(v_mult, 3);
  loan_fund_balance := coalesce(v_fund, 0);
  active_loans := coalesce(v_loans, 0);
  return next;
end;
$$;
