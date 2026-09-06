-- Fix: cannot execute INSERT in a read-only transaction
-- Cause: get_member_loan_limit / list_chama_kits were STABLE but called ensure_chama_kits (INSERT)

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
    raise exception ''Not authenticated'';
  end if;
  if p_user_id is distinct from auth.uid() and not public.is_chama_member(p_chama_id) then
    raise exception ''Not allowed'';
  end if;

  select coalesce(sum(b.balance), 0) into v_shares
  from public.member_kit_balances b
  join public.chama_kits k on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_user_id
    and k.counts_toward_loan_limit = true;

  select coalesce((constitution->>''maxLoanMultiple'')::numeric, 3) into v_mult
  from public.chamas where id = p_chama_id;

  select coalesce(balance, 0) into v_fund
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = ''member-loans'';

  select coalesce(active_loans, 0) into v_loans
  from public.chama_members
  where chama_id = p_chama_id and user_id = p_user_id and status = ''active'';

  return query select
    coalesce(v_shares, 0),
    coalesce(v_mult, 3),
    coalesce(v_shares, 0) * coalesce(v_mult, 3),
    coalesce(v_fund, 0),
    coalesce(v_loans, 0);
end;
$$;

create or replace function public.list_chama_kits(p_chama_id uuid)
returns setof public.chama_kits
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_chama_member(p_chama_id) and not exists (
    select 1 from public.chamas c where c.id = p_chama_id and c.created_by = auth.uid()
  ) then
    raise exception ''Not allowed'';
  end if;
  perform public.ensure_chama_kits(p_chama_id);
  return query
    select k.* from public.chama_kits k
    where k.chama_id = p_chama_id
    order by k.is_loan_fund desc, k.kit_code;
end;
$$;
