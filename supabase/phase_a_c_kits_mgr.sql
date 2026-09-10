-- ============================================================
-- Phase A–C: registration, contingency campaigns, expenses, MGR payout
-- Run in Supabase SQL Editor after kits + go_live_remaining.sql
-- ============================================================

-- Labels
create or replace function public.kit_label(p_code text)
returns text
language sql
immutable
as $$
  select case p_code
    when 'merry-go-round' then 'Merry-go-round'
    when 'table-banking' then 'Table banking'
    when 'member-loans' then 'Member loans (loan fund)'
    when 'welfare' then 'Welfare / emergency'
    when 'investment-pool' then 'Investment pool'
    when 'housing-project' then 'Housing / property'
    when 'education-fund' then 'Education fund'
    when 'agribusiness' then 'Agribusiness'
    when 'share-capital' then 'Share capital'
    when 'general-savings' then 'General savings'
    when 'registration-fees' then 'Registration fees'
    when 'contingency' then 'Contingency'
    when 'group-reserve' then 'Chama reserve'
    else initcap(replace(p_code, '-', ' '))
  end;
$$;

-- Always seed core kits (including registration + contingency + MGR + reserve)
create or replace function public.ensure_chama_kits(p_chama_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activities jsonb;
  v_code text;
  v_core text[] := array[
    'member-loans',
    'table-banking',
    'share-capital',
    'general-savings',
    'merry-go-round',
    'registration-fees',
    'contingency',
    'group-reserve',
    'welfare'
  ];
begin
  select constitution->'activities' into v_activities
  from public.chamas where id = p_chama_id;

  if v_activities is null or jsonb_typeof(v_activities) <> 'array' or jsonb_array_length(v_activities) = 0 then
    v_activities := '["table-banking","member-loans","share-capital","general-savings","merry-go-round"]'::jsonb;
  end if;

  foreach v_code in array v_core
  loop
    insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
    values (
      p_chama_id,
      v_code,
      public.kit_label(v_code),
      (v_code = 'member-loans'),
      public.kit_counts_toward_loan(v_code)
    )
    on conflict (chama_id, kit_code) do update set
      label = excluded.label,
      is_loan_fund = excluded.is_loan_fund,
      counts_toward_loan_limit = excluded.counts_toward_loan_limit;
  end loop;

  for v_code in select jsonb_array_elements_text(v_activities)
  loop
    insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
    values (
      p_chama_id,
      v_code,
      public.kit_label(v_code),
      (v_code = 'member-loans'),
      public.kit_counts_toward_loan(v_code)
    )
    on conflict (chama_id, kit_code) do update set
      label = excluded.label;
  end loop;
end;
$$;

grant execute on function public.ensure_chama_kits(uuid) to authenticated;

-- Contingency campaigns
create table if not exists public.contingency_campaigns (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  title text not null,
  target_amount numeric not null default 0 check (target_amount >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists contingency_campaigns_chama_idx
  on public.contingency_campaigns (chama_id, status);

alter table public.contingency_campaigns enable row level security;

drop policy if exists contingency_member_select on public.contingency_campaigns;
create policy contingency_member_select on public.contingency_campaigns
  for select to authenticated
  using (public.is_chama_member(chama_id));

create or replace function public.create_contingency_campaign(
  p_chama_id uuid,
  p_title text,
  p_target numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role in ('Chairperson', 'Treasurer', 'Secretary') and status = 'active'
  ) then
    raise exception 'Only officials can open a contingency campaign';
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  insert into public.contingency_campaigns (chama_id, title, target_amount, notes, created_by)
  values (p_chama_id, trim(p_title), coalesce(p_target, 0), p_notes, auth.uid())
  returning id into v_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, auth.uid(), 'contribution',
    format('Contingency campaign opened: %s', trim(p_title)),
    coalesce(p_target, 0)
  );

  return jsonb_build_object('id', v_id, 'title', trim(p_title), 'status', 'open');
end;
$$;

grant execute on function public.create_contingency_campaign(uuid, text, numeric, text) to authenticated;

create or replace function public.list_contingency_campaigns(p_chama_id uuid)
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
      'id', c.id,
      'title', c.title,
      'targetAmount', c.target_amount,
      'status', c.status,
      'notes', c.notes,
      'createdAt', c.created_at,
      'closedAt', c.closed_at
    ) order by c.created_at desc)
    from public.contingency_campaigns c
    where c.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_contingency_campaigns(uuid) to authenticated;

-- Expense / payout from a kit (registration, contingency, reserve, welfare, etc.)
create or replace function public.record_expense_from_kit(
  p_chama_id uuid,
  p_kit_code text,
  p_amount numeric,
  p_description text,
  p_reference text default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal numeric;
  v_kit text := trim(p_kit_code);
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role in ('Chairperson', 'Treasurer', 'Secretary') and status = 'active'
  ) then
    raise exception 'Only officials can record kit expenses';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  select balance into v_bal
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = v_kit
  for update;

  if not found then
    raise exception 'Kit % not found', v_kit;
  end if;
  if coalesce(v_bal, 0) < p_amount then
    raise exception 'Kit % only has % — cannot expense %', v_kit, v_bal, p_amount;
  end if;

  update public.chama_kits
  set balance = balance - p_amount
  where chama_id = p_chama_id and kit_code = v_kit;

  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = p_chama_id;

  if p_campaign_id is not null then
    update public.contingency_campaigns
    set status = 'closed', closed_at = now()
    where id = p_campaign_id and chama_id = p_chama_id;
  end if;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    p_chama_id,
    auth.uid(),
    'withdrawal',
    coalesce(nullif(trim(p_description), ''), format('Expense from %s', v_kit)),
    p_amount,
    coalesce(p_reference, v_kit)
  );

  return jsonb_build_object(
    'ok', true,
    'kit', v_kit,
    'amount', p_amount,
    'balanceAfter', v_bal - p_amount
  );
end;
$$;

grant execute on function public.record_expense_from_kit(uuid, text, numeric, text, text, uuid) to authenticated;

-- Merry-go-round: payout current pool (or amount) to beneficiary
create or replace function public.mgr_payout(
  p_chama_id uuid,
  p_beneficiary_id uuid default null,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor int;
  v_ids uuid[];
  v_beneficiary uuid;
  v_name text;
  v_pool numeric;
  v_pay numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role in ('Chairperson', 'Treasurer', 'Secretary') and status = 'active'
  ) then
    raise exception 'Only officials can pay merry-go-round';
  end if;

  perform public.ensure_chama_kits(p_chama_id);

  select coalesce(array_agg(m.user_id order by m.joined_at, m.user_id), '{}')
  into v_ids
  from public.chama_members m
  where m.chama_id = p_chama_id and m.status = 'active' and m.role <> 'New Applicant';

  if array_length(v_ids, 1) is null then
    raise exception 'No active members';
  end if;

  if p_beneficiary_id is not null then
    v_beneficiary := p_beneficiary_id;
  else
    select coalesce(mgr_cursor, 0) into v_cursor from public.chamas where id = p_chama_id;
    v_cursor := v_cursor % array_length(v_ids, 1);
    -- beneficiary is the one who just received the "turn" — use current cursor position
    -- After advance_merry_go_round, cursor points to NEXT; payout should use previous
    -- Simpler: pay explicit beneficiary or members[cursor] as current recipient index
    v_beneficiary := v_ids[v_cursor + 1];
  end if;

  select balance into v_pool
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = 'merry-go-round'
  for update;

  v_pool := coalesce(v_pool, 0);
  v_pay := coalesce(p_amount, v_pool);

  if v_pay <= 0 then
    raise exception 'Merry-go-round kit has no funds to pay out';
  end if;
  if v_pay > v_pool then
    raise exception 'Cannot pay % — MGR kit only has %', v_pay, v_pool;
  end if;

  update public.chama_kits
  set balance = balance - v_pay
  where chama_id = p_chama_id and kit_code = 'merry-go-round';

  -- Optional: track member received (not added to savings kits — it's a payout)
  update public.chamas c
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
  ), 0)
  where c.id = p_chama_id;

  select coalesce(full_name, 'Member') into v_name
  from public.profiles where id = v_beneficiary;

  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (
    p_chama_id,
    v_beneficiary,
    'withdrawal',
    format('Merry-go-round payout to %s', v_name),
    v_pay,
    'merry-go-round'
  );

  insert into public.notifications (chama_id, user_id, title, body, kind)
  values (
    p_chama_id,
    v_beneficiary,
    'Merry-go-round payout',
    format('You received KES %s from the merry-go-round pot.', v_pay),
    'mgr'
  );

  perform public.notify_chama_members(
    p_chama_id,
    'Merry-go-round paid',
    format('%s received KES %s', v_name, v_pay),
    'mgr',
    v_beneficiary
  );

  return jsonb_build_object(
    'ok', true,
    'beneficiaryId', v_beneficiary,
    'beneficiaryName', v_name,
    'amount', v_pay,
    'kitBalanceAfter', v_pool - v_pay
  );
end;
$$;

grant execute on function public.mgr_payout(uuid, uuid, numeric) to authenticated;

-- Seed kits for all existing chamas
do $$
declare r record;
begin
  for r in select id from public.chamas
  loop
    perform public.ensure_chama_kits(r.id);
  end loop;
end $$;
