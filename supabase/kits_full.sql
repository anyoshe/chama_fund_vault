-- ============================================================
-- KITS (separate pots) — build on existing contributions
-- Run once in Supabase SQL Editor after contribution_persistence.sql
-- ============================================================
-- Rules:
-- 1. Each activity can have its own kit balance
-- 2. member-loans kit is always present (loan fund — separate)
-- 3. Contributions credit the chosen destination kit
-- 4. Member balances in share-like kits drive loan eligibility
-- 5. Existing pool_balance is kept in sync as sum of kit balances
-- ============================================================

create table if not exists public.chama_kits (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  kit_code text not null,
  label text not null,
  balance numeric not null default 0 check (balance >= 0),
  is_loan_fund boolean not null default false,
  counts_toward_loan_limit boolean not null default false,
  created_at timestamptz not null default now(),
  unique (chama_id, kit_code)
);

create index if not exists idx_chama_kits_chama on public.chama_kits (chama_id);

create table if not exists public.member_kit_balances (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kit_code text not null,
  balance numeric not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  unique (chama_id, user_id, kit_code)
);

create index if not exists idx_member_kit_balances_member
  on public.member_kit_balances (chama_id, user_id);

alter table public.chama_kits enable row level security;
alter table public.member_kit_balances enable row level security;

drop policy if exists "Kits: members can read" on public.chama_kits;
create policy "Kits: members can read"
  on public.chama_kits for select
  using (public.is_chama_member(chama_id));

drop policy if exists "Member kit balances: members can read" on public.member_kit_balances;
create policy "Member kit balances: members can read"
  on public.member_kit_balances for select
  using (
    user_id = auth.uid()
    or public.is_chama_member(chama_id)
  );

-- Label helper
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
    else initcap(replace(p_code, '-', ' '))
  end;
$$;

create or replace function public.kit_counts_toward_loan(p_code text)
returns boolean
language sql
immutable
as $$
  -- Monthly savings / shares style pots determine loan capacity
  select p_code in (
    'table-banking',
    'share-capital',
    'general-savings'
  );
$$;

-- Ensure kits exist for a chama (from constitution.activities + loan fund)
create or replace function public.ensure_chama_kits(p_chama_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activities jsonb;
  v_code text;
begin
  select constitution->'activities' into v_activities
  from public.chamas where id = p_chama_id;

  if v_activities is null or jsonb_typeof(v_activities) <> 'array' or jsonb_array_length(v_activities) = 0 then
    v_activities := '["table-banking","member-loans","general-savings"]'::jsonb;
  end if;

  -- Always ensure loan fund kit exists
  insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
  values (p_chama_id, 'member-loans', public.kit_label('member-loans'), true, false)
  on conflict (chama_id, kit_code) do update set
    label = excluded.label,
    is_loan_fund = true,
    counts_toward_loan_limit = false;

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
      label = excluded.label,
      counts_toward_loan_limit = excluded.counts_toward_loan_limit;
  end loop;
end;
$$;

grant execute on function public.ensure_chama_kits(uuid) to authenticated;

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
    raise exception 'Not allowed';
  end if;
  -- volatile so ensure_chama_kits INSERT is allowed
  perform public.ensure_chama_kits(p_chama_id);
  return query
    select k.* from public.chama_kits k
    where k.chama_id = p_chama_id
    order by k.is_loan_fund desc, k.kit_code;
end;
$$;

grant execute on function public.list_chama_kits(uuid) to authenticated;

-- Loan-eligible shares for a member (sum of share-like kit balances)
create or replace function public.member_loan_shares(p_chama_id uuid, p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(b.balance), 0)
  from public.member_kit_balances b
  join public.chama_kits k
    on k.chama_id = b.chama_id and k.kit_code = b.kit_code
  where b.chama_id = p_chama_id
    and b.user_id = p_user_id
    and k.counts_toward_loan_limit = true;
$$;

grant execute on function public.member_loan_shares(uuid, uuid) to authenticated;

-- Replace record_contribution to credit kits (keeps same signature)
create or replace function public.record_contribution(
  p_chama_id uuid,
  p_amount numeric,
  p_destination text,
  p_method text,
  p_phone text,
  p_payment_details text,
  p_reference text
)
returns public.contributions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contributions;
  v_dest text;
begin
  if not public.is_chama_member(p_chama_id) then
    raise exception 'You are not an active member of this chama';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Contribution amount must be greater than zero';
  end if;
  if nullif(trim(p_destination), '') is null or nullif(trim(p_method), '') is null then
    raise exception 'Contribution destination and payment method are required';
  end if;

  v_dest := trim(p_destination);
  perform public.ensure_chama_kits(p_chama_id);

  -- Auto-create kit row if destination is new
  insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit)
  values (
    p_chama_id,
    v_dest,
    public.kit_label(v_dest),
    (v_dest = 'member-loans'),
    public.kit_counts_toward_loan(v_dest)
  )
  on conflict (chama_id, kit_code) do nothing;

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, confirmed_at
  )
  values (
    p_chama_id, auth.uid(), p_amount, v_dest, trim(p_method),
    nullif(trim(p_phone), ''), nullif(trim(p_payment_details), ''),
    trim(p_reference), 'completed', now()
  )
  on conflict (reference) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.contributions where reference = trim(p_reference);
    if v_row.chama_id <> p_chama_id or v_row.member_id <> auth.uid() then
      raise exception 'Payment reference already belongs to another transaction';
    end if;
    return v_row;
  end if;

  -- Member total_paid (all contributions)
  update public.chama_members
  set total_paid = total_paid + p_amount
  where chama_id = p_chama_id
    and user_id = auth.uid()
    and status = 'active';

  -- Kit balances
  update public.chama_kits
  set balance = balance + p_amount
  where chama_id = p_chama_id and kit_code = v_dest;

  insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
  values (p_chama_id, auth.uid(), v_dest, p_amount, now())
  on conflict (chama_id, user_id, kit_code) do update set
    balance = public.member_kit_balances.balance + excluded.balance,
    updated_at = now();

  -- Keep legacy pool_balance as sum of all kits
  update public.chamas c
  set pool_balance = coalesce((
        select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
      ), 0),
      month_collected = month_collected + p_amount
  where c.id = p_chama_id;

  return v_row;
end;
$$;

grant execute on function public.record_contribution(uuid, numeric, text, text, text, text, text)
  to authenticated;

-- One-time: seed kits for existing chamas (balances start 0; optional backfill below)
do $$
declare r record;
begin
  for r in select id from public.chamas
  loop
    perform public.ensure_chama_kits(r.id);
  end loop;
end $$;

-- Optional backfill kit balances from existing completed contributions
insert into public.chama_kits (chama_id, kit_code, label, is_loan_fund, counts_toward_loan_limit, balance)
select
  c.chama_id,
  c.destination,
  public.kit_label(c.destination),
  (c.destination = 'member-loans'),
  public.kit_counts_toward_loan(c.destination),
  sum(c.amount)
from public.contributions c
where c.status = 'completed'
group by c.chama_id, c.destination
on conflict (chama_id, kit_code) do update set
  balance = excluded.balance;

insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
select
  c.chama_id,
  c.member_id,
  c.destination,
  sum(c.amount),
  now()
from public.contributions c
where c.status = 'completed'
group by c.chama_id, c.member_id, c.destination
on conflict (chama_id, user_id, kit_code) do update set
  balance = excluded.balance,
  updated_at = now();

-- Sync chama.pool_balance from kits
update public.chamas c
set pool_balance = coalesce((
  select sum(k.balance) from public.chama_kits k where k.chama_id = c.id
), c.pool_balance);
