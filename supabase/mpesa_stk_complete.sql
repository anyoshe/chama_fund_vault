-- M-Pesa STK tracking + ensure dual payment SQL applied first

create table if not exists public.mpesa_stk_requests (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid references public.contributions (id) on delete set null,
  checkout_request_id text unique,
  merchant_request_id text,
  phone text,
  amount numeric,
  chama_id uuid references public.chamas (id) on delete cascade,
  mpesa_receipt text,
  status text default 'pending',
  result_desc text,
  created_at timestamptz not null default now()
);

create index if not exists mpesa_stk_checkout_idx on public.mpesa_stk_requests (checkout_request_id);

alter table public.mpesa_stk_requests enable row level security;
drop policy if exists mpesa_stk_select on public.mpesa_stk_requests;
create policy mpesa_stk_select on public.mpesa_stk_requests
  for select to authenticated
  using (
    public.is_chama_official(chama_id)
    or exists (
      select 1 from public.contributions c
      where c.id = contribution_id and c.member_id = auth.uid()
    )
  );

-- Default new chamas / unset → manual_confirm must be explicit for pay flow in app
-- (app no longer allows silent record_contribution)
