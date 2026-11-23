-- Chair late-fine settings + auto assess + invite helpers + MGR cycle helpers

-- 1) Chair sets late fine % and grace days on constitution
create or replace function public.set_chama_late_fine_settings(
  p_chama_id uuid,
  p_late_fine_rate numeric,
  p_grace_days int default 0,
  p_auto_fines boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select role into v_role from public.chama_members
  where chama_id = p_chama_id and user_id = auth.uid() and status = 'active';
  if v_role is distinct from 'Chairperson' then
    raise exception 'Only the Chairperson can set late fine rules';
  end if;
  if p_late_fine_rate is null or p_late_fine_rate < 0 or p_late_fine_rate > 100 then
    raise exception 'Late fine rate must be between 0 and 100 (%)';
  end if;

  update public.chamas
  set constitution = coalesce(constitution, '{}'::jsonb)
    || jsonb_build_object(
      'lateFineRate', p_late_fine_rate,
      'lateFineGraceDays', greatest(0, coalesce(p_grace_days, 0)),
      'autoFinesEnabled', coalesce(p_auto_fines, true)
    )
  where id = p_chama_id;

  return jsonb_build_object(
    'ok', true,
    'lateFineRate', p_late_fine_rate,
    'graceDays', greatest(0, coalesce(p_grace_days, 0)),
    'autoFinesEnabled', coalesce(p_auto_fines, true)
  );
end;
$$;

grant execute on function public.set_chama_late_fine_settings(uuid, numeric, int, boolean) to authenticated;

-- 2) Assess with grace days from constitution
create or replace function public.assess_late_fines_for_chama(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
  v_grace int;
  r record;
  v_fine numeric;
  v_count int := 0;
  v_total numeric := 0;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can assess late fines';
  end if;

  select
    coalesce((constitution->>'lateFineRate')::numeric, 0),
    coalesce((constitution->>'lateFineGraceDays')::int, 0)
  into v_rate, v_grace
  from public.chamas where id = p_chama_id;

  if v_rate is null or v_rate <= 0 then
    return jsonb_build_object('assessed', 0, 'message', 'lateFineRate is 0 — set in Settings');
  end if;

  for r in
    select o.id, o.member_id, o.expected_amount, o.paid_amount, o.due_date
    from public.contribution_obligations o
    where o.chama_id = p_chama_id
      and o.status in ('pending', 'partial', 'overdue')
      and o.due_date + v_grace < current_date
      and (o.expected_amount - coalesce(o.paid_amount, 0)) > 0
  loop
    v_fine := round(((r.expected_amount - coalesce(r.paid_amount, 0)) * v_rate / 100.0)::numeric, 2);
    if v_fine < 1 then continue; end if;

    insert into public.member_penalties (
      chama_id, member_id, obligation_id, amount, reason, status
    ) values (
      p_chama_id, r.member_id, r.id, v_fine,
      format('Late fine %s%% (grace %s days) · due %s', v_rate, v_grace, r.due_date),
      'open'
    )
    on conflict (obligation_id) do nothing;

    if found then
      v_count := v_count + 1;
      v_total := v_total + v_fine;
      update public.contribution_obligations
      set status = 'overdue'
      where id = r.id and status in ('pending', 'partial');
    end if;
  end loop;

  return jsonb_build_object('assessed', v_count, 'totalFines', v_total, 'rate', v_rate, 'graceDays', v_grace);
end;
$$;

grant execute on function public.assess_late_fines_for_chama(uuid) to authenticated;

-- 3) Cron/service role: all chamas with auto fines on
create or replace function public.auto_assess_late_fines_all_chamas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  o record;
  v_rate numeric;
  v_grace int;
  v_fine numeric;
  v_count int;
  v_total numeric;
  v_list jsonb := '[]'::jsonb;
  v_n int := 0;
begin
  for r in
    select id, constitution from public.chamas
    where coalesce((constitution->>'autoFinesEnabled')::boolean, true) = true
      and coalesce((constitution->>'lateFineRate')::numeric, 0) > 0
  loop
    v_rate := coalesce((r.constitution->>'lateFineRate')::numeric, 0);
    v_grace := coalesce((r.constitution->>'lateFineGraceDays')::int, 0);
    v_count := 0;
    v_total := 0;

    for o in
      select * from public.contribution_obligations
      where chama_id = r.id
        and status in ('pending', 'partial', 'overdue')
        and due_date + v_grace < current_date
        and (expected_amount - coalesce(paid_amount, 0)) > 0
    loop
      v_fine := round(((o.expected_amount - coalesce(o.paid_amount, 0)) * v_rate / 100.0)::numeric, 2);
      if v_fine < 1 then
        continue;
      end if;
      insert into public.member_penalties (
        chama_id, member_id, obligation_id, amount, reason, status
      ) values (
        r.id, o.member_id, o.id, v_fine,
        format('Auto late fine %s%% · due %s', v_rate, o.due_date),
        'open'
      )
      on conflict (obligation_id) do nothing;
      if found then
        v_count := v_count + 1;
        v_total := v_total + v_fine;
        update public.contribution_obligations set status = 'overdue' where id = o.id;
      end if;
    end loop;

    v_list := v_list || jsonb_build_array(jsonb_build_object(
      'chamaId', r.id, 'assessed', v_count, 'total', v_total
    ));
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('chamasProcessed', v_n, 'results', v_list);
end;
$$;

grant execute on function public.auto_assess_late_fines_all_chamas() to service_role;

-- 4) Invites
create table if not exists public.chama_invites (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas (id) on delete cascade,
  code text not null unique,
  max_uses int not null default 50,
  uses int not null default 0,
  expires_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists chama_invites_chama_idx on public.chama_invites (chama_id);

alter table public.chama_invites enable row level security;

create or replace function public.create_chama_invite(
  p_chama_id uuid,
  p_max_uses int default 30,
  p_days_valid int default 30
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can create invite codes';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.chama_invites (chama_id, code, max_uses, expires_at, created_by)
  values (
    p_chama_id,
    v_code,
    greatest(1, coalesce(p_max_uses, 30)),
    case when p_days_valid is null then null else now() + make_interval(days => greatest(1, p_days_valid)) end,
    auth.uid()
  );
  return v_code;
end;
$$;

grant execute on function public.create_chama_invite(uuid, int, int) to authenticated;

create or replace function public.redeem_chama_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.chama_invites%rowtype;
  v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first, then redeem the code'; end if;
  select * into v_inv from public.chama_invites
  where upper(code) = upper(trim(p_code));
  if not found then raise exception 'Invalid invite code'; end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    raise exception 'Invite code has expired';
  end if;
  if v_inv.uses >= v_inv.max_uses then
    raise exception 'Invite code has no uses left';
  end if;

  insert into public.chama_members (chama_id, user_id, role, status)
  values (v_inv.chama_id, auth.uid(), 'Member', 'active')
  on conflict (chama_id, user_id) do update set status = 'active';

  update public.chama_invites set uses = uses + 1 where id = v_inv.id;

  select name into v_name from public.chamas where id = v_inv.chama_id;

  return jsonb_build_object(
    'ok', true,
    'chamaId', v_inv.chama_id,
    'chamaName', v_name,
    'message', format('You joined %s', coalesce(v_name, 'the chama'))
  );
end;
$$;

grant execute on function public.redeem_chama_invite(text) to authenticated;

-- 5) MGR: ensure cursor column + run cycle (advance then optional notify)
alter table public.chamas add column if not exists mgr_cursor int default 0;
alter table public.chamas add column if not exists mgr_last_run date;

create or replace function public.run_merry_go_round_cycle(p_chama_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_advance jsonb;
  v_payout jsonb;
  v_bal numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_official(p_chama_id) then
    raise exception 'Only officials can run merry-go-round';
  end if;

  -- Advance recipient cursor
  begin
    v_advance := public.advance_merry_go_round(p_chama_id);
  exception when others then
    raise exception 'advance_merry_go_round failed: %', SQLERRM;
  end;

  select coalesce(balance, 0) into v_bal
  from public.chama_kits
  where chama_id = p_chama_id and kit_code = 'merry-go-round';

  if coalesce(v_bal, 0) > 0 then
    begin
      v_payout := public.mgr_payout(p_chama_id, null);
    exception when others then
      v_payout := jsonb_build_object('error', SQLERRM, 'advanced', true);
    end;
  else
    v_payout := jsonb_build_object('skipped', true, 'reason', 'Merry-go-round pot is empty');
  end if;

  update public.chamas set mgr_last_run = current_date where id = p_chama_id;

  return jsonb_build_object(
    'ok', true,
    'advance', v_advance,
    'payout', v_payout,
    'potBalance', coalesce(v_bal, 0)
  );
end;
$$;

grant execute on function public.run_merry_go_round_cycle(uuid) to authenticated;
