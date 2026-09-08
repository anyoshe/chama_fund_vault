-- One-time: if share-capital (or other) kit has more than sum of member balances,
-- distribute the gap as interest using contribution/balance weights.
-- Run in SQL Editor after inspecting which kit holds the undistributed interest.

-- Example for share-capital (adjust kit_code if needed):
do $$
declare
  r record;
  v_chama uuid;
  v_kit text := 'share-capital';
  v_kit_bal numeric;
  v_member_sum numeric;
  v_gap numeric;
  v_total_w numeric;
  v_share numeric;
  w record;
begin
  for v_chama in select id from public.chamas
  loop
    select coalesce(balance, 0) into v_kit_bal
    from public.chama_kits where chama_id = v_chama and kit_code = v_kit;

    select coalesce(sum(balance), 0) into v_member_sum
    from public.member_kit_balances
    where chama_id = v_chama and kit_code = v_kit;

    v_gap := v_kit_bal - v_member_sum;
    if v_gap <= 0.01 then
      raise notice 'chama % kit %: no gap', v_chama, v_kit;
      continue;
    end if;

    -- Weights from current member balances, else contributions
    select coalesce(sum(balance), 0) into v_total_w
    from public.member_kit_balances
    where chama_id = v_chama and kit_code = v_kit and balance > 0;

    if v_total_w <= 0 then
      select coalesce(sum(amount), 0) into v_total_w
      from public.contributions
      where chama_id = v_chama and destination = v_kit
        and status in ('completed', 'complete', 'confirmed', 'paid', 'success');
    end if;

    if v_total_w <= 0 then
      raise notice 'chama %: no weights for %', v_chama, v_kit;
      continue;
    end if;

    -- Distribute gap to members by weight
    if exists (
      select 1 from public.member_kit_balances
      where chama_id = v_chama and kit_code = v_kit and balance > 0
    ) then
      for w in
        select user_id, balance
        from public.member_kit_balances
        where chama_id = v_chama and kit_code = v_kit and balance > 0
      loop
        v_share := round((v_gap * (w.balance / v_total_w))::numeric, 2);
        update public.member_kit_balances
        set balance = balance + v_share, updated_at = now()
        where chama_id = v_chama and user_id = w.user_id and kit_code = v_kit;
      end loop;
    else
      for w in
        select member_id as user_id, sum(amount) as balance
        from public.contributions
        where chama_id = v_chama and destination = v_kit
          and status in ('completed', 'complete', 'confirmed', 'paid', 'success')
          and member_id is not null
        group by member_id
      loop
        v_share := round((v_gap * (w.balance / v_total_w))::numeric, 2);
        insert into public.member_kit_balances (chama_id, user_id, kit_code, balance, updated_at)
        values (v_chama, w.user_id, v_kit, v_share, now())
        on conflict (chama_id, user_id, kit_code) do update set
          balance = public.member_kit_balances.balance + excluded.balance,
          updated_at = now();
      end loop;
    end if;

    raise notice 'chama % kit % distributed gap %', v_chama, v_kit, v_gap;
  end loop;
end $$;
