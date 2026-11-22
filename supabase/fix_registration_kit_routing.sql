-- Registration fees must credit registration-fees kit (not welfare).
-- Also backfill: move amounts already credited to welfare for registration payments.
-- Run in Supabase SQL Editor once.

-- 1) Fix member self-pay obligation routing
create or replace function public.pay_contribution_obligation(
  p_obligation_id uuid,
  p_amount numeric,
  p_method text default 'Other',
  p_reference text default null,
  p_phone text default null,
  p_payment_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o public.contribution_obligations%rowtype;
  v_plan public.contribution_plans%rowtype;
  v_pay numeric;
  v_new_paid numeric;
  v_status text;
  v_contrib public.contributions%rowtype;
  v_ref text;
  v_bucket text;
  v_const jsonb;
  v_welfare_mode boolean;
  v_dest text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select * into v_o from public.contribution_obligations where id = p_obligation_id for update;
  if not found then raise exception 'Obligation not found'; end if;
  if v_o.member_id <> auth.uid() then
    raise exception 'You can only pay your own obligations';
  end if;
  if v_o.status in ('paid', 'waived', 'cancelled') then
    raise exception 'Obligation is already %', v_o.status;
  end if;

  select * into v_plan from public.contribution_plans where id = v_o.plan_id;
  v_dest := coalesce(nullif(trim(v_plan.destination_kit), ''), 'general-savings');
  -- Never treat registration as a "retired" welfare alias
  if lower(v_dest) in ('registration', 'reg-fees') then
    v_dest := 'registration-fees';
  end if;

  v_pay := least(p_amount, greatest(0, v_o.expected_amount - v_o.paid_amount));
  if not v_plan.allow_partial and v_pay + 0.001 < (v_o.expected_amount - v_o.paid_amount) then
    raise exception 'Partial payments are not allowed on this plan';
  end if;

  v_ref := coalesce(nullif(trim(p_reference), ''),
    'OBL-' || substr(gen_random_uuid()::text, 1, 8));

  insert into public.contributions (
    chama_id, member_id, amount, destination, method, phone,
    payment_details, reference, status, confirmed_at, obligation_id
  ) values (
    v_o.chama_id, auth.uid(), v_pay, v_dest,
    coalesce(nullif(trim(p_method), ''), 'Other'),
    nullif(trim(p_phone), ''), nullif(trim(p_payment_details), ''),
    v_ref, 'completed', now(), v_o.id
  )
  on conflict (reference) do nothing
  returning * into v_contrib;

  if v_contrib.id is null then
    select * into v_contrib from public.contributions where reference = v_ref;
  end if;

  select constitution into v_const from public.chamas where id = v_o.chama_id;

  -- Welfare channel only for true welfare/contingency (or explicit flag for non-registration).
  -- Registration fees ALWAYS stay in registration-fees kit.
  v_welfare_mode :=
    v_dest in ('welfare', 'contingency')
    or (
      coalesce((v_const->>'channelContributionsToWelfare')::boolean, false)
      and v_dest not in ('registration-fees', 'registration')
    );

  if v_welfare_mode then
    v_bucket := case
      when lower(v_plan.name) like '%registration%' then 'registration'
      else 'monthly_contribution'
    end;
    perform public.credit_welfare_kitty(v_o.chama_id, v_pay, v_bucket, auth.uid());
  else
    perform public.ensure_chama_kits(v_o.chama_id);
    insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
    values (
      v_o.chama_id, v_dest, public.kit_label(v_dest),
      v_pay, false, public.kit_counts_toward_loan(v_dest)
    )
    on conflict (chama_id, kit_code) do update set
      balance = public.chama_kits.balance + excluded.balance;

    insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
    values (v_o.chama_id, auth.uid(), v_dest, v_pay, now())
    on conflict (chama_id, user_id, kit_code) do update set
      balance = public.member_kit_balances.balance + excluded.balance,
      updated_at = now();
  end if;

  update public.chama_members
  set total_paid = total_paid + v_pay
  where chama_id = v_o.chama_id and user_id = auth.uid() and status = 'active';

  update public.chamas
  set pool_balance = coalesce((
    select sum(k.balance) from public.chama_kits k where k.chama_id = public.chamas.id
  ), 0),
  month_collected = month_collected + v_pay
  where id = v_o.chama_id;

  v_new_paid := v_o.paid_amount + v_pay;
  v_status := case
    when v_new_paid >= v_o.expected_amount - 0.01 then 'paid'
    when v_new_paid > 0 then 'partial'
    else 'pending'
  end;

  update public.contribution_obligations set
    paid_amount = v_new_paid,
    status = v_status,
    updated_at = now()
  where id = v_o.id;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'paid', v_pay,
    'destination', v_dest,
    'welfareMode', v_welfare_mode,
    'outstanding', greatest(0, v_o.expected_amount - v_new_paid)
  );
end;
$$;

grant execute on function public.pay_contribution_obligation(uuid, numeric, text, text, text, text) to authenticated;

-- 2) Backfill: registration contributions that landed only in welfare
do $$
declare
  r record;
  v_expected numeric;
  v_have numeric;
  v_need numeric;
  v_welfare numeric;
  v_move numeric;
begin
  for r in
    select c.id as chama_id, c.name
    from public.chamas c
  loop
    select coalesce(sum(amount), 0) into v_expected
    from public.contributions
    where chama_id = r.chama_id
      and status = 'completed'
      and destination in ('registration-fees', 'registration');

    if v_expected <= 0 then
      continue;
    end if;

    insert into public.chama_kits (chama_id, kit_code, label, balance, is_loan_fund, counts_toward_loan_limit)
    values (
      r.chama_id, 'registration-fees',
      coalesce(public.kit_label('registration-fees'), 'Registration fees'),
      0, false, false
    )
    on conflict (chama_id, kit_code) do nothing;

    select coalesce(balance, 0) into v_have
    from public.chama_kits
    where chama_id = r.chama_id and kit_code = 'registration-fees';

    v_need := v_expected - coalesce(v_have, 0);
    if v_need <= 0.001 then
      continue;
    end if;

    select coalesce(balance, 0) into v_welfare
    from public.chama_kits
    where chama_id = r.chama_id and kit_code = 'welfare';

    v_move := least(v_need, coalesce(v_welfare, 0));
    -- Always credit registration-fees to match contribution history
    update public.chama_kits
    set balance = coalesce(balance, 0) + v_need
    where chama_id = r.chama_id and kit_code = 'registration-fees';

    if v_move > 0 then
      update public.chama_kits
      set balance = balance - v_move
      where chama_id = r.chama_id and kit_code = 'welfare';

      -- Reduce welfare registration bucket if present
      update public.welfare_fund_buckets
      set balance = greatest(0, balance - v_move)
      where chama_id = r.chama_id and bucket_code = 'registration';
    end if;

    -- Member balances: attribute registration contributions to registration-fees
    insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
    select
      c.chama_id,
      c.member_id,
      'registration-fees',
      sum(c.amount),
      now()
    from public.contributions c
    where c.chama_id = r.chama_id
      and c.status = 'completed'
      and c.destination in ('registration-fees', 'registration')
    group by c.chama_id, c.member_id
    on conflict (chama_id, user_id, kit_code) do update set
      balance = excluded.balance,
      updated_at = now();

    update public.chamas
    set pool_balance = coalesce((
      select sum(k.balance) from public.chama_kits k where k.chama_id = r.chama_id
    ), 0)
    where id = r.chama_id;

    insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
    values (
      r.chama_id, null, 'contribution',
      format(
        'Backfill registration-fees kit · expected %s · had %s · moved from welfare %s',
        v_expected, v_have, v_move
      ),
      v_need,
      'FIX-REG-KIT'
    );

    raise notice 'Chama %: registration expected % had % need % moved from welfare %',
      r.name, v_expected, v_have, v_need, v_move;
  end loop;
end;
$$;

-- Quick check (optional)
select
  ch.name,
  k.kit_code,
  k.balance
from public.chama_kits k
join public.chamas ch on ch.id = k.chama_id
where k.kit_code in ('registration-fees', 'welfare')
order by ch.name, k.kit_code;
