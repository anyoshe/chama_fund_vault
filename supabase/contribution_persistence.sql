-- Durable contribution recording and audit trail.
-- Run this once in the Supabase SQL Editor.

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete restrict,
  amount numeric not null check (amount > 0),
  destination text not null,
  method text not null check (method in ('M-Pesa STK Push', 'Airtel Money', 'Bank EFT / RTGS', 'PesaLink', 'Other')),
  phone text,
  payment_details text,
  reference text not null unique,
  status text not null default 'completed' check (status in ('completed', 'pending', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id)
);

create index if not exists idx_contributions_chama_date
  on public.contributions (chama_id, created_at desc);
create index if not exists idx_contributions_member_date
  on public.contributions (member_id, created_at desc);

alter table public.contributions enable row level security;

drop policy if exists "Contributions: members can read chama records" on public.contributions;
create policy "Contributions: members can read chama records"
  on public.contributions for select
  using (public.is_chama_member(chama_id));

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

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, confirmed_at
  )
  values (
    p_chama_id, auth.uid(), p_amount, trim(p_destination), trim(p_method),
    nullif(trim(p_phone), ''), nullif(trim(p_payment_details), ''),
    trim(p_reference), 'completed', now()
  )
  on conflict (reference) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.contributions
    where reference = trim(p_reference);
    if v_row.chama_id <> p_chama_id or v_row.member_id <> auth.uid() then
      raise exception 'Payment reference already belongs to another transaction';
    end if;
    return v_row;
  end if;

  update public.chama_members
  set total_paid = total_paid + p_amount
  where chama_id = p_chama_id
    and user_id = auth.uid()
    and status = 'active';

  update public.chamas
  set pool_balance = pool_balance + p_amount,
      month_collected = month_collected + p_amount
  where id = p_chama_id;

  return v_row;
end;
$$;

grant execute on function public.record_contribution(uuid, numeric, text, text, text, text, text)
  to authenticated;
