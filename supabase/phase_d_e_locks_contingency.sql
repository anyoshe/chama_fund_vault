-- ============================================================
-- Phase D–E: share withdrawal locks + contingency campaign payout
-- Run after phase_a_c_kits_mgr.sql
-- ============================================================

create table if not exists public.share_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  kit_code text not null default 'share-capital',
  amount numeric not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'paid')),
  reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists share_withdrawal_chama_idx
  on public.share_withdrawal_requests (chama_id, status);

alter table public.share_withdrawal_requests enable row level security;

drop policy if exists share_wd_select on public.share_withdrawal_requests;
create policy share_wd_select on public.share_withdrawal_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_chama_member(chama_id)
  );

create or replace function public.share_withdraw_allowed(
  p_chama_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_months int;
  v_joined timestamptz;
  v_const jsonb;
begin
  select constitution into v_const from public.chamas where id = p_chama_id;
  v_mode := coalesce(v_const->>'shareWithdrawMode', 'locked');
  v_months := coalesce((v_const->>'shareLockMonths')::int, 12);

  if v_mode = 'break-up-only' then
    return false; -- only via special break-up process (officials force later)
  end if;

  if v_mode = 'locked' then
    return false;
  end if;

  select joined_at into v_joined
  from public.chama_members
  where chama_id = p_chama_id and user_id = p_user_id;

  if v_joined is null then
    return false;
  end if;

  if v_mode = 'anniversary' or v_mode = 'exit-with-notice' then
    return (v_joined + make_interval(months => greatest(v_months, 1))) <= now();
  end if;

  return false;
end;
$$;

grant execute on function public.share_withdraw_allowed(uuid, uuid) to authenticated;

create or replace function public.request_share_withdrawal(
  p_chama_id uuid,
  p_amount numeric,
  p_reason text default null,
  p_kit_code text default 'share-capital'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_id uuid;
  v_kit text := coalesce(nullif(trim(p_kit_code), ''), 'share-capital');
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  -- member-loans kit: never withdraw as savings
  if v_kit = 'member-loans' then
    raise exception 'Member-loans kit is lending capital — withdrawals are not allowed';
  end if;

  if v_kit = 'registration-fees' then
    raise exception 'Registration fees are not refundable';
  end if;

  if v_kit in ('share-capital', 'table-banking') then
    if not public.share_withdraw_allowed(p_chama_id, v_uid) then
      raise exception 'Share/table-banking withdrawals are locked by chama rules (locked period or break-up only)';
    end if;
  end if;

  select coalesce(balance, 0) into v_bal
  from public.member_kit_balances
  where chama_id = p_chama_id and user_id = v_uid and kit_code = v_kit;

  if coalesce(v_bal, 0) < p_amount then
    raise exception 'Insufficient balance in % (have %)', v_kit, coalesce(v_bal, 0);
  end if;

  insert into public.share_withdrawal_requests (
    chama_id, user_id, kit_code, amount, status, reason
  ) values (
    p_chama_id, v_uid, v_kit, p_amount, 'pending', p_reason
  )
  returning id into v_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    p_chama_id, v_uid, 'withdrawal',
    format('Withdrawal request: %s from %s', p_amount, v_kit),
    p_amount, v_kit
  );

  return jsonb_build_object('id', v_id, 'status', 'pending', 'amount', p_amount, 'kit', v_kit);
end;
$$;

grant execute on function public.request_share_withdrawal(uuid, numeric, text, text) to authenticated;

create or replace function public.decide_share_withdrawal(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.share_withdrawal_requests%rowtype;
  v_kit_bal numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_req from public.share_withdrawal_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is not pending'; end if;

  if not exists (
    select 1 from public.chama_members
    where chama_id = v_req.chama_id and user_id = auth.uid()
      and role in ('Chairperson', 'Treasurer', 'Secretary') and status = 'active'
  ) then
    raise exception 'Only officials can approve or reject withdrawals';
  end if;

  if not p_approve then
    update public.share_withdrawal_requests
    set status = 'rejected', decided_by = auth.uid(), decided_at = now()
    where id = p_request_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- Debit member + group kit
  select balance into v_kit_bal
  from public.chama_kits
  where chama_id = v_req.chama_id and kit_code = v_req.kit_code
  for update;

  if coalesce(v_kit_bal, 0) < v_req.amount then
    raise exception 'Kit balance too low to pay withdrawal';
  end if;

  update public.chama_kits
  set balance = balance - v_req.amount
  where chama_id = v_req.chama_id and kit_code = v_req.kit_code;

  update public.member_kit_balances
  set balance = greatest(0, balance - v_req.amount), updated_at = now()
  where chama_id = v_req.chama_id and user_id = v_req.user_id and kit_code = v_req.kit_code;

  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = v_req.chama_id;

  update public.share_withdrawal_requests
  set status = 'paid', decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    v_req.chama_id, v_req.user_id, 'withdrawal',
    format('Withdrawal paid from %s', v_req.kit_code),
    v_req.amount, v_req.kit_code
  );

  insert into public.notifications (chama_id, user_id, title, body, kind)
  values (
    v_req.chama_id, v_req.user_id,
    'Withdrawal approved',
    format('KES %s from %s has been approved and recorded.', v_req.amount, v_req.kit_code),
    'withdrawal'
  );

  return jsonb_build_object('ok', true, 'status', 'paid', 'amount', v_req.amount);
end;
$$;

grant execute on function public.decide_share_withdrawal(uuid, boolean) to authenticated;

create or replace function public.list_share_withdrawal_requests(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'userId', r.user_id,
      'kitCode', r.kit_code,
      'amount', r.amount,
      'status', r.status,
      'reason', r.reason,
      'createdAt', r.created_at,
      'decidedAt', r.decided_at
    ) order by r.created_at desc)
    from public.share_withdrawal_requests r
    where r.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_share_withdrawal_requests(uuid) to authenticated;

-- Contingency: pay out and close campaign in one step
create or replace function public.close_contingency_campaign(
  p_campaign_id uuid,
  p_amount numeric,
  p_description text default null,
  p_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contingency_campaigns%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into v_c from public.contingency_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if v_c.status <> 'open' then raise exception 'Campaign is already closed'; end if;

  select public.record_expense_from_kit(
    v_c.chama_id,
    'contingency',
    p_amount,
    coalesce(p_description, format('Contingency payout: %s', v_c.title)),
    coalesce(p_reference, 'contingency'),
    p_campaign_id
  ) into v_result;

  return v_result || jsonb_build_object('campaignId', p_campaign_id, 'campaignTitle', v_c.title);
end;
$$;

grant execute on function public.close_contingency_campaign(uuid, numeric, text, text) to authenticated;

-- Chair: update share lock settings on constitution
create or replace function public.update_share_lock_settings(
  p_chama_id uuid,
  p_mode text,
  p_lock_months int default 12
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role = 'Chairperson' and status = 'active'
  ) then
    raise exception 'Only chairperson can change share lock settings';
  end if;

  if p_mode not in ('locked', 'anniversary', 'break-up-only', 'exit-with-notice') then
    raise exception 'Invalid shareWithdrawMode';
  end if;

  update public.chamas
  set constitution = constitution
    || jsonb_build_object(
      'shareWithdrawMode', p_mode,
      'shareLockMonths', greatest(1, coalesce(p_lock_months, 12)),
      'registrationFeeRequired', coalesce((constitution->>'registrationFeeRequired')::boolean, true)
    )
  where id = p_chama_id;
end;
$$;

grant execute on function public.update_share_lock_settings(uuid, text, int) to authenticated;
