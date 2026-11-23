-- Merry-go-round fair wheel: unique numbers 1..N, then payout order follows numbers

create table if not exists public.mgr_draws (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'closed', 'active')),
  member_count int not null default 0,
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.mgr_draw_slots (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.mgr_draws (id) on delete cascade,
  chama_id uuid not null references public.chamas (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  slot_number int not null check (slot_number >= 1),
  claimed_at timestamptz not null default now(),
  unique (draw_id, member_id),
  unique (draw_id, slot_number)
);

create index if not exists mgr_draw_slots_chama_idx
  on public.mgr_draw_slots (chama_id, draw_id);

alter table public.mgr_draws enable row level security;
alter table public.mgr_draw_slots enable row level security;

drop policy if exists mgr_draws_select on public.mgr_draws;
create policy mgr_draws_select on public.mgr_draws
  for select to authenticated
  using (public.is_chama_member(chama_id));

drop policy if exists mgr_slots_select on public.mgr_draw_slots;
create policy mgr_slots_select on public.mgr_draw_slots
  for select to authenticated
  using (public.is_chama_member(chama_id));

-- Official opens a new wheel round (closes previous open/active for this chama)
create or replace function public.start_mgr_wheel_draw(
  p_chama_id uuid,
  p_hours_open int default 72
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can open the merry-go-round wheel';
  end if;

  select count(*)::int into v_n
  from public.chama_members
  where chama_id = p_chama_id and status = 'active' and coalesce(role, '') <> 'New Applicant';

  if v_n < 2 then
    raise exception 'Need at least 2 active members for a wheel draw';
  end if;

  update public.mgr_draws
  set status = 'closed', closes_at = coalesce(closes_at, now())
  where chama_id = p_chama_id and status in ('open', 'active');

  insert into public.mgr_draws (
    chama_id, status, member_count, opens_at, closes_at, created_by
  ) values (
    p_chama_id,
    'open',
    v_n,
    now(),
    now() + make_interval(hours => greatest(1, coalesce(p_hours_open, 72))),
    auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'drawId', v_id,
    'memberCount', v_n,
    'numbersAvailable', v_n,
    'closesAt', (now() + make_interval(hours => greatest(1, coalesce(p_hours_open, 72))))
  );
end;
$$;

grant execute on function public.start_mgr_wheel_draw(uuid, int) to authenticated;

-- Member claims one random remaining number (spin)
create or replace function public.claim_mgr_wheel_number(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draw public.mgr_draws%rowtype;
  v_taken int[];
  v_pool int[];
  v_pick int;
  i int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;

  select * into v_draw
  from public.mgr_draws
  where chama_id = p_chama_id and status = 'open'
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No open merry-go-round wheel. Ask an official to open a draw.';
  end if;

  if v_draw.closes_at is not null and v_draw.closes_at < now() then
    raise exception 'Wheel selection period has closed';
  end if;

  if exists (
    select 1 from public.mgr_draw_slots
    where draw_id = v_draw.id and member_id = auth.uid()
  ) then
    select slot_number into v_pick
    from public.mgr_draw_slots
    where draw_id = v_draw.id and member_id = auth.uid();
    return jsonb_build_object(
      'ok', true,
      'alreadyClaimed', true,
      'slotNumber', v_pick,
      'drawId', v_draw.id
    );
  end if;

  select coalesce(array_agg(slot_number order by slot_number), '{}')
  into v_taken
  from public.mgr_draw_slots
  where draw_id = v_draw.id;

  v_pool := '{}';
  for i in 1..v_draw.member_count loop
    if not (i = any (v_taken)) then
      v_pool := array_append(v_pool, i);
    end if;
  end loop;

  if array_length(v_pool, 1) is null then
    raise exception 'All numbers are already taken';
  end if;

  -- Random unique pick from remaining
  v_pick := v_pool[1 + floor(random() * array_length(v_pool, 1))::int];

  insert into public.mgr_draw_slots (draw_id, chama_id, member_id, slot_number)
  values (v_draw.id, p_chama_id, auth.uid(), v_pick);

  -- Auto-close when all members have numbers
  if (
    select count(*) from public.mgr_draw_slots where draw_id = v_draw.id
  ) >= v_draw.member_count then
    update public.mgr_draws
    set status = 'active', closes_at = now()
    where id = v_draw.id;
    -- Cursor starts at number 1 (lowest)
    update public.chamas set mgr_cursor = 0 where id = p_chama_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'alreadyClaimed', false,
    'slotNumber', v_pick,
    'drawId', v_draw.id,
    'remaining', (
      select v_draw.member_count - count(*) from public.mgr_draw_slots where draw_id = v_draw.id
    )
  );
end;
$$;

grant execute on function public.claim_mgr_wheel_number(uuid) to authenticated;

-- Status + order for UI
create or replace function public.get_mgr_wheel_status(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_draw public.mgr_draws%rowtype;
  v_slots jsonb;
  v_my int;
  v_order jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member';
  end if;

  select * into v_draw
  from public.mgr_draws
  where chama_id = p_chama_id and status in ('open', 'active')
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('hasDraw', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'memberId', s.member_id,
    'name', coalesce(p.full_name, 'Member'),
    'slotNumber', s.slot_number,
    'claimedAt', s.claimed_at
  ) order by s.slot_number), '[]'::jsonb)
  into v_slots
  from public.mgr_draw_slots s
  left join public.profiles p on p.id = s.member_id
  where s.draw_id = v_draw.id;

  select slot_number into v_my
  from public.mgr_draw_slots
  where draw_id = v_draw.id and member_id = auth.uid();

  -- Payout order = ascending slot numbers
  v_order := v_slots;

  return jsonb_build_object(
    'hasDraw', true,
    'drawId', v_draw.id,
    'status', v_draw.status,
    'memberCount', v_draw.member_count,
    'claimedCount', (select count(*) from public.mgr_draw_slots where draw_id = v_draw.id),
    'closesAt', v_draw.closes_at,
    'myNumber', v_my,
    'slots', v_slots,
    'payoutOrder', v_order
  );
end;
$$;

grant execute on function public.get_mgr_wheel_status(uuid) to authenticated;

-- Who is next for payment using wheel numbers (not join date)
create or replace function public.get_mgr_current_recipient(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_draw public.mgr_draws%rowtype;
  v_cursor int;
  v_slots int[];
  v_ids uuid[];
  v_idx int;
  v_member uuid;
  v_num int;
  v_name text;
begin
  select * into v_draw
  from public.mgr_draws
  where chama_id = p_chama_id and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'No active wheel order — open a draw and let everyone pick');
  end if;

  select
    coalesce(array_agg(s.slot_number order by s.slot_number), '{}'),
    coalesce(array_agg(s.member_id order by s.slot_number), '{}')
  into v_slots, v_ids
  from public.mgr_draw_slots s
  where s.draw_id = v_draw.id;

  if array_length(v_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'No numbers claimed');
  end if;

  select coalesce(mgr_cursor, 0) into v_cursor from public.chamas where id = p_chama_id;
  v_idx := (v_cursor % array_length(v_ids, 1));
  v_member := v_ids[v_idx + 1];
  v_num := v_slots[v_idx + 1];

  select coalesce(full_name, 'Member') into v_name from public.profiles where id = v_member;

  return jsonb_build_object(
    'ok', true,
    'memberId', v_member,
    'name', v_name,
    'slotNumber', v_num,
    'position', v_idx + 1,
    'total', array_length(v_ids, 1)
  );
end;
$$;

grant execute on function public.get_mgr_current_recipient(uuid) to authenticated;

-- Advance using wheel order
create or replace function public.advance_mgr_wheel_turn(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur jsonb;
  v_n int;
  v_cursor int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can advance merry-go-round';
  end if;

  v_cur := public.get_mgr_current_recipient(p_chama_id);
  if coalesce((v_cur->>'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_cur->>'reason', 'No active wheel');
  end if;

  select count(*)::int into v_n
  from public.mgr_draw_slots s
  join public.mgr_draws d on d.id = s.draw_id
  where d.chama_id = p_chama_id and d.status = 'active';

  select coalesce(mgr_cursor, 0) into v_cursor from public.chamas where id = p_chama_id;
  update public.chamas
  set mgr_cursor = (v_cursor + 1) % greatest(v_n, 1)
  where id = p_chama_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id,
    (v_cur->>'memberId')::uuid,
    'withdrawal',
    format('MGR wheel turn paid/advanced · #%s · %s', v_cur->>'slotNumber', v_cur->>'name'),
    0
  );

  return jsonb_build_object(
    'ok', true,
    'paidOrAdvanced', v_cur,
    'nextCursor', (v_cursor + 1) % greatest(v_n, 1)
  );
end;
$$;

grant execute on function public.advance_mgr_wheel_turn(uuid) to authenticated;
