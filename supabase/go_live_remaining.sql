-- ============================================================
-- Remaining non-M-Pesa go-live features
-- Fines, notifications, invite redeem, merry-go-round cursor
-- Run after proposals_ledger_persistence.sql
-- ============================================================

-- Notifications (in-app; email/SMS providers optional later)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  kind text not null default 'info',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.list_my_notifications(p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id,
      'chamaId', n.chama_id,
      'title', n.title,
      'body', n.body,
      'kind', n.kind,
      'readAt', n.read_at,
      'createdAt', n.created_at
    ) order by n.created_at desc)
    from (
      select * from public.notifications
      where user_id = auth.uid()
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 40), 100))
    ) n
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_my_notifications(int) to authenticated;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set read_at = now()
  where id = p_id and user_id = auth.uid();
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.notify_chama_members(
  p_chama_id uuid,
  p_title text,
  p_body text,
  p_kind text default 'info',
  p_exclude uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  insert into public.notifications (chama_id, user_id, title, body, kind)
  select p_chama_id, m.user_id, p_title, p_body, coalesce(p_kind, 'info')
  from public.chama_members m
  where m.chama_id = p_chama_id
    and m.status = 'active'
    and (p_exclude is null or m.user_id <> p_exclude);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Fines ledger
create table if not exists public.fines (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  cycle_key text not null,
  amount numeric not null check (amount >= 0),
  reason text not null default '',
  status text not null default 'open' check (status in ('open', 'paid', 'waived')),
  created_at timestamptz not null default now(),
  unique (chama_id, user_id, cycle_key)
);

alter table public.fines enable row level security;

drop policy if exists fines_member_select on public.fines;
create policy fines_member_select on public.fines
  for select to authenticated
  using (public.is_chama_member(chama_id));

-- Close contribution cycle: post fines for shortfall
create or replace function public.close_contribution_cycle(
  p_chama_id uuid,
  p_cycle_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cycle text;
  v_rate numeric;
  v_target numeric;
  r record;
  v_paid numeric;
  v_short numeric;
  v_fine numeric;
  v_count int := 0;
  v_total numeric := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = v_uid
      and role in ('Chairperson', 'Treasurer', 'Secretary')
      and status = 'active'
  ) then
    raise exception 'Only officials can close a contribution cycle';
  end if;

  v_cycle := coalesce(
    nullif(trim(p_cycle_key), ''),
    to_char(now(), 'YYYY-MM')
  );

  select coalesce((constitution->>'lateFineRate')::numeric, 10),
         coalesce(monthly_target, coalesce((constitution->>'minMonthlyContribution')::numeric, 0))
  into v_rate, v_target
  from public.chamas
  where id = p_chama_id;

  if v_target is null or v_target <= 0 then
    v_target := 0;
  end if;

  for r in
    select m.user_id,
           coalesce(m.monthly_contribution, v_target) as target
    from public.chama_members m
    where m.chama_id = p_chama_id
      and m.status = 'active'
      and m.role <> 'New Applicant'
  loop
    select coalesce(sum(c.amount), 0) into v_paid
    from public.contributions c
    where c.chama_id = p_chama_id
      and c.member_id = r.user_id
      and c.status in ('completed', 'complete', 'confirmed', 'paid', 'success')
      and to_char(coalesce(c.confirmed_at, c.created_at), 'YYYY-MM') = v_cycle;

    v_short := greatest(0, r.target - v_paid);
    if v_short <= 0 then
      continue;
    end if;

    v_fine := round((v_short * coalesce(v_rate, 0) / 100.0)::numeric, 2);
    if v_fine <= 0 then
      continue;
    end if;

    insert into public.fines (chama_id, user_id, cycle_key, amount, reason, status)
    values (
      p_chama_id,
      r.user_id,
      v_cycle,
      v_fine,
      format('Late/short contribution %s: shortfall %s @ %s%%', v_cycle, v_short, v_rate),
      'open'
    )
    on conflict (chama_id, user_id, cycle_key) do update
      set amount = excluded.amount,
          reason = excluded.reason;

    insert into public.audit_events (chama_id, member_id, type, description, amount)
    values (
      p_chama_id, r.user_id, 'penalty',
      format('Fine posted for cycle %s', v_cycle), v_fine
    );

    insert into public.notifications (chama_id, user_id, title, body, kind)
    values (
      p_chama_id, r.user_id,
      format('Fine posted · %s', v_cycle),
      format('KES %s for contribution shortfall. Settle with the treasurer.', v_fine),
      'fine'
    );

    v_count := v_count + 1;
    v_total := v_total + v_fine;
  end loop;

  perform public.notify_chama_members(
    p_chama_id,
    format('Contribution cycle %s closed', v_cycle),
    format('%s member fine(s) posted, total KES %s', v_count, v_total),
    'cycle',
    null
  );

  return jsonb_build_object(
    'ok', true,
    'cycle', v_cycle,
    'finesPosted', v_count,
    'totalFines', v_total
  );
end;
$$;

grant execute on function public.close_contribution_cycle(uuid, text) to authenticated;

create or replace function public.list_chama_fines(p_chama_id uuid)
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
      'id', f.id,
      'userId', f.user_id,
      'cycleKey', f.cycle_key,
      'amount', f.amount,
      'reason', f.reason,
      'status', f.status,
      'createdAt', f.created_at
    ) order by f.created_at desc)
    from public.fines f
    where f.chama_id = p_chama_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_chama_fines(uuid) to authenticated;

-- Redeem invite code → join as Active Member
create or replace function public.redeem_chama_invite(
  p_code text,
  p_monthly numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.chama_invites%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_inv
  from public.chama_invites
  where upper(code) = upper(trim(p_code))
    and active = true
  for update;

  if not found then raise exception 'Invalid invite code'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    raise exception 'Invite code expired';
  end if;
  if v_inv.uses >= coalesce(v_inv.max_uses, 50) then
    raise exception 'Invite code has no remaining uses';
  end if;

  if exists (
    select 1 from public.chama_members
    where chama_id = v_inv.chama_id and user_id = v_uid
  ) then
    update public.chama_invites set uses = uses + 1 where id = v_inv.id;
    return v_inv.chama_id;
  end if;

  insert into public.chama_members (
    chama_id, user_id, role, monthly_contribution, status
  ) values (
    v_inv.chama_id,
    v_uid,
    'Active Member',
    coalesce(p_monthly, 0),
    'active'
  );

  update public.chama_invites set uses = uses + 1 where id = v_inv.id;

  insert into public.notifications (chama_id, user_id, title, body, kind)
  values (
    v_inv.chama_id, v_uid,
    'Welcome to the chama',
    'You joined via invite code. Check Overview and My Finance.',
    'welcome'
  );

  return v_inv.chama_id;
end;
$$;

grant execute on function public.redeem_chama_invite(text, numeric) to authenticated;

-- Merry-go-round: store rotation index on chama constitution-like column
alter table public.chamas
  add column if not exists mgr_cursor int not null default 0;

create or replace function public.advance_merry_go_round(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cursor int;
  v_ids uuid[];
  v_next uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = v_uid
      and role in ('Chairperson', 'Treasurer', 'Secretary') and status = 'active'
  ) then
    raise exception 'Only officials can advance merry-go-round';
  end if;

  select coalesce(array_agg(m.user_id order by m.joined_at, m.user_id), '{}')
  into v_ids
  from public.chama_members m
  where m.chama_id = p_chama_id and m.status = 'active' and m.role <> 'New Applicant';

  if array_length(v_ids, 1) is null or array_length(v_ids, 1) = 0 then
    raise exception 'No active members for rotation';
  end if;

  select mgr_cursor into v_cursor from public.chamas where id = p_chama_id;
  v_cursor := coalesce(v_cursor, 0) % array_length(v_ids, 1);
  v_next := v_ids[v_cursor + 1];

  update public.chamas
  set mgr_cursor = (v_cursor + 1) % array_length(v_ids, 1)
  where id = p_chama_id;

  select coalesce(full_name, 'Member') into v_name
  from public.profiles where id = v_next;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, v_next, 'withdrawal',
    format('Merry-go-round turn: %s', v_name), 0
  );

  perform public.notify_chama_members(
    p_chama_id,
    'Merry-go-round advanced',
    format('Next recipient: %s', v_name),
    'mgr',
    null
  );

  return jsonb_build_object(
    'ok', true,
    'recipientId', v_next,
    'recipientName', v_name,
    'nextCursor', (v_cursor + 1) % array_length(v_ids, 1)
  );
end;
$$;

grant execute on function public.advance_merry_go_round(uuid) to authenticated;

-- Notify on loan proposal (call from app after create)
create or replace function public.notify_loan_proposed(p_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.proposals%rowtype;
begin
  select * into v_p from public.proposals where id = p_proposal_id;
  if not found then return; end if;
  perform public.notify_chama_members(
    v_p.chama_id,
    'Loan vote needed',
    v_p.title || ' · KES ' || v_p.amount::text,
    'vote',
    v_p.requester_id
  );
end;
$$;

grant execute on function public.notify_loan_proposed(uuid) to authenticated;
