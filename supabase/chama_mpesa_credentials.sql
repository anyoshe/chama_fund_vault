-- Per-chama Daraja credentials (officials enter in Settings; Edge Function reads with service role)

create table if not exists public.chama_mpesa_credentials (
  chama_id uuid primary key references public.chamas (id) on delete cascade,
  consumer_key text not null,
  consumer_secret text not null,
  passkey text not null,
  shortcode text not null,
  -- paybill | till
  shortcode_type text not null default 'paybill'
    check (shortcode_type in ('paybill', 'till')),
  environment text not null default 'sandbox'
    check (environment in ('sandbox', 'production')),
  account_reference text,
  transaction_desc text default 'ChamaVault',
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.chama_mpesa_credentials enable row level security;

drop policy if exists mpesa_cred_select on public.chama_mpesa_credentials;
-- Members must NOT read secrets. Only service role / security definer RPCs.
create policy mpesa_cred_select on public.chama_mpesa_credentials
  for select using (false);

drop policy if exists mpesa_cred_write on public.chama_mpesa_credentials;
create policy mpesa_cred_write on public.chama_mpesa_credentials
  for all using (false);

-- Officials save credentials (never returned in full to client after save)
create or replace function public.upsert_chama_mpesa_credentials(
  p_chama_id uuid,
  p_consumer_key text,
  p_consumer_secret text,
  p_passkey text,
  p_shortcode text,
  p_shortcode_type text default 'paybill',
  p_environment text default 'sandbox',
  p_account_reference text default null,
  p_transaction_desc text default 'ChamaVault'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only chair, treasurer or secretary can save M-Pesa credentials';
  end if;
  if nullif(trim(p_consumer_key), '') is null
     or nullif(trim(p_consumer_secret), '') is null
     or nullif(trim(p_passkey), '') is null
     or nullif(trim(p_shortcode), '') is null then
    raise exception 'Consumer key, secret, passkey and shortcode are required';
  end if;
  if coalesce(p_shortcode_type, 'paybill') not in ('paybill', 'till') then
    raise exception 'Shortcode type must be paybill or till';
  end if;
  if coalesce(p_environment, 'sandbox') not in ('sandbox', 'production') then
    raise exception 'Environment must be sandbox or production';
  end if;

  insert into public.chama_mpesa_credentials (
    chama_id, consumer_key, consumer_secret, passkey, shortcode,
    shortcode_type, environment, account_reference, transaction_desc,
    updated_by, updated_at
  ) values (
    p_chama_id,
    trim(p_consumer_key),
    trim(p_consumer_secret),
    trim(p_passkey),
    trim(p_shortcode),
    coalesce(nullif(trim(p_shortcode_type), ''), 'paybill'),
    coalesce(nullif(trim(p_environment), ''), 'sandbox'),
    nullif(trim(p_account_reference), ''),
    coalesce(nullif(trim(p_transaction_desc), ''), 'ChamaVault'),
    auth.uid(),
    now()
  )
  on conflict (chama_id) do update set
    consumer_key = excluded.consumer_key,
    consumer_secret = excluded.consumer_secret,
    passkey = excluded.passkey,
    shortcode = excluded.shortcode,
    shortcode_type = excluded.shortcode_type,
    environment = excluded.environment,
    account_reference = excluded.account_reference,
    transaction_desc = excluded.transaction_desc,
    updated_by = auth.uid(),
    updated_at = now();

  -- Flip payment mode hint if still unset
  update public.chamas
  set constitution = jsonb_set(
    coalesce(constitution, '{}'::jsonb),
    '{mpesaConfigured}',
    'true'::jsonb,
    true
  )
  where id = p_chama_id;

  return jsonb_build_object(
    'ok', true,
    'configured', true,
    'shortcode', trim(p_shortcode),
    'environment', coalesce(nullif(trim(p_environment), ''), 'sandbox')
  );
end;
$$;

grant execute on function public.upsert_chama_mpesa_credentials(uuid, text, text, text, text, text, text, text, text) to authenticated;

-- Safe status for UI (no secrets)
create or replace function public.get_chama_mpesa_status(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.chama_mpesa_credentials%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member';
  end if;

  select * into r from public.chama_mpesa_credentials where chama_id = p_chama_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;

  return jsonb_build_object(
    'configured', true,
    'shortcode', r.shortcode,
    'shortcodeType', r.shortcode_type,
    'environment', r.environment,
    'accountReference', r.account_reference,
    'updatedAt', r.updated_at
  );
end;
$$;

grant execute on function public.get_chama_mpesa_status(uuid) to authenticated;

-- Edge Function (service role) loads full secrets
create or replace function public.get_chama_mpesa_credentials_internal(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.chama_mpesa_credentials%rowtype;
begin
  select * into r from public.chama_mpesa_credentials where chama_id = p_chama_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'consumerKey', r.consumer_key,
    'consumerSecret', r.consumer_secret,
    'passkey', r.passkey,
    'shortcode', r.shortcode,
    'shortcodeType', r.shortcode_type,
    'environment', r.environment,
    'accountReference', r.account_reference,
    'transactionDesc', r.transaction_desc
  );
end;
$$;

-- Only service_role should call this; grant to service_role if available
grant execute on function public.get_chama_mpesa_credentials_internal(uuid) to service_role;
