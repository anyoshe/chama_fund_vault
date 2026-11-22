-- Robust manual pending payment (run in Supabase SQL Editor)
alter table public.contributions
  add column if not exists payment_date date;
alter table public.contributions
  add column if not exists approved_by uuid;
alter table public.contributions
  add column if not exists approved_at timestamptz;

-- Ensure pending is allowed (already in schema check)

create or replace function public.submit_pending_contribution(
  p_chama_id uuid,
  p_amount numeric,
  p_destination text,
  p_method text,
  p_reference text,
  p_payment_date date default current_date,
  p_payment_details text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ref text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_amount is null or p_amount < 1 then
    raise exception 'Enter an amount of at least Ksh 1';
  end if;
  if nullif(trim(p_destination), '') is null then
    raise exception 'Choose a pot';
  end if;

  v_ref := coalesce(
    nullif(trim(p_reference), ''),
    'PEND-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  );

  -- Unique reference: if taken, append suffix
  if exists (select 1 from public.contributions where reference = v_ref) then
    v_ref := v_ref || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, payment_date, created_at, created_by
  ) values (
    p_chama_id,
    auth.uid(),
    p_amount,
    trim(p_destination),
    coalesce(nullif(trim(p_method), ''), 'Other'),
    nullif(trim(p_phone), ''),
    nullif(trim(p_payment_details), ''),
    v_ref,
    'pending',
    coalesce(p_payment_date, current_date),
    now(),
    auth.uid()
  )
  returning id into v_id;

  begin
    insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
    values (
      p_chama_id, auth.uid(), 'contribution',
      format('Payment submitted for approval · %s · %s', trim(p_destination), v_ref),
      p_amount, v_ref
    );
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'id', v_id,
    'status', 'pending',
    'reference', v_ref,
    'message', 'Waiting for treasurer to confirm receipt'
  );
end;
$$;

grant execute on function public.submit_pending_contribution(uuid, numeric, text, text, text, date, text, text) to authenticated;
