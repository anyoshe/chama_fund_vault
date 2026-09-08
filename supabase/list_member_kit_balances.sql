-- Member kit balances for standings (contributions + interest credits)

create or replace function public.list_member_kit_balances(p_chama_id uuid)
returns table (
  user_id uuid,
  kit_code text,
  balance numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;

  return query
  select b.user_id, b.kit_code, b.balance
  from public.member_kit_balances b
  where b.chama_id = p_chama_id
  order by b.user_id, b.kit_code;
end;
$$;

grant execute on function public.list_member_kit_balances(uuid) to authenticated;

-- Improve weight snapshot: if no balances, derive from completed contributions
create or replace function public.snapshot_interest_weights(
  p_chama_id uuid,
  p_basis text default 'share-capital'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_weights jsonb := '{}'::jsonb;
  r record;
  v_total numeric := 0;
  v_basis text := coalesce(nullif(trim(p_basis), ''), 'share-capital');
begin
  if v_basis = 'four-kits' then
    for r in
      select b.user_id, coalesce(sum(b.balance), 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id
        and b.kit_code = any (public.loan_liquidity_codes())
      group by b.user_id
      having coalesce(sum(b.balance), 0) > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  elsif v_basis = 'table-banking' then
    for r in
      select b.user_id, coalesce(b.balance, 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id and b.kit_code = 'table-banking' and b.balance > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  elsif v_basis = 'member-loans' then
    for r in
      select b.user_id, coalesce(b.balance, 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id and b.kit_code = 'member-loans' and b.balance > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  else
    -- share-capital
    for r in
      select b.user_id, coalesce(b.balance, 0) as bal
      from public.member_kit_balances b
      where b.chama_id = p_chama_id and b.kit_code = 'share-capital' and b.balance > 0
    loop
      v_total := v_total + r.bal;
      v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
    end loop;
  end if;

  -- Fallback: build from contributions if no member_kit_balances yet
  if v_total <= 0 then
    v_weights := '{}'::jsonb;
    if v_basis = 'four-kits' then
      for r in
        select c.member_id as user_id, coalesce(sum(c.amount), 0) as bal
        from public.contributions c
        where c.chama_id = p_chama_id
          and c.status in ('completed', 'complete', 'confirmed', 'paid', 'success')
          and c.destination = any (public.loan_liquidity_codes())
          and c.member_id is not null
        group by c.member_id
        having coalesce(sum(c.amount), 0) > 0
      loop
        v_total := v_total + r.bal;
        v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
      end loop;
    else
      for r in
        select c.member_id as user_id, coalesce(sum(c.amount), 0) as bal
        from public.contributions c
        where c.chama_id = p_chama_id
          and c.status in ('completed', 'complete', 'confirmed', 'paid', 'success')
          and c.destination = case v_basis
            when 'table-banking' then 'table-banking'
            when 'member-loans' then 'member-loans'
            else 'share-capital'
          end
          and c.member_id is not null
        group by c.member_id
        having coalesce(sum(c.amount), 0) > 0
      loop
        v_total := v_total + r.bal;
        v_weights := v_weights || jsonb_build_object(r.user_id::text, r.bal);
      end loop;
    end if;
  end if;

  if v_total <= 0 then
    return '{}'::jsonb;
  end if;

  for r in select * from jsonb_each(v_weights)
  loop
    v_weights := jsonb_set(
      v_weights,
      array[r.key],
      to_jsonb(round((r.value::text::numeric / v_total)::numeric, 8))
    );
  end loop;

  return v_weights;
end;
$$;

grant execute on function public.snapshot_interest_weights(uuid, text) to authenticated;
