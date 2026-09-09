-- ============================================================
-- Proposals, votes, audit ledger — server source of truth
-- Run in Supabase SQL Editor (production readiness)
-- ============================================================

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  type text not null check (type in ('loan', 'withdrawal', 'payout', 'investment')),
  title text not null,
  amount numeric not null check (amount > 0),
  requester_id uuid not null references auth.users(id),
  reason text not null default '',
  status text not null default 'active'
    check (status in ('active', 'approved', 'rejected', 'disbursed', 'settled')),
  quorum_threshold numeric not null default 0.6,
  guarantor_ids uuid[] default '{}',
  repayment jsonb,
  disbursement jsonb,
  disbursed_at timestamptz,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proposals_chama_idx on public.proposals (chama_id, status);
create index if not exists proposals_requester_idx on public.proposals (requester_id);

create table if not exists public.proposal_votes (
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  voter_id uuid not null references auth.users(id),
  vote text not null check (vote in ('approve', 'reject', 'abstain')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, voter_id)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  member_id uuid references auth.users(id),
  type text not null,
  description text not null default '',
  amount numeric not null default 0,
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_chama_idx on public.audit_events (chama_id, created_at desc);

create table if not exists public.chama_invites (
  id uuid primary key default gen_random_uuid(),
  chama_id uuid not null references public.chamas(id) on delete cascade,
  code text not null unique,
  created_by uuid references auth.users(id),
  max_uses int default 50,
  uses int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.proposals enable row level security;
alter table public.proposal_votes enable row level security;
alter table public.audit_events enable row level security;
alter table public.chama_invites enable row level security;

drop policy if exists proposals_member_select on public.proposals;
create policy proposals_member_select on public.proposals
  for select to authenticated
  using (public.is_chama_member(chama_id));

drop policy if exists votes_member_select on public.proposal_votes;
create policy votes_member_select on public.proposal_votes
  for select to authenticated
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_id and public.is_chama_member(p.chama_id)
    )
  );

drop policy if exists audit_member_select on public.audit_events;
create policy audit_member_select on public.audit_events
  for select to authenticated
  using (public.is_chama_member(chama_id));

drop policy if exists invites_member_select on public.chama_invites;
create policy invites_member_select on public.chama_invites
  for select to authenticated
  using (public.is_chama_member(chama_id));

-- List proposals + votes for a chama
create or replace function public.list_chama_proposals(p_chama_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;

  select coalesce(jsonb_agg(row_data order by requested_at desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', p.id,
      'chamaId', p.chama_id,
      'type', p.type,
      'title', p.title,
      'amount', p.amount,
      'requesterId', p.requester_id,
      'reason', p.reason,
      'status', p.status,
      'quorumThreshold', p.quorum_threshold,
      'guarantorIds', coalesce(to_jsonb(p.guarantor_ids), '[]'::jsonb),
      'requestedAt', p.requested_at,
      'disbursedAt', p.disbursed_at,
      'repayment', p.repayment,
      'disbursement', p.disbursement,
      'votes', coalesce((
        select jsonb_object_agg(v.voter_id::text, v.vote)
        from public.proposal_votes v
        where v.proposal_id = p.id
      ), '{}'::jsonb)
    ) as row_data,
    p.requested_at
    from public.proposals p
    where p.chama_id = p_chama_id
  ) s;

  return v_result;
end;
$$;

grant execute on function public.list_chama_proposals(uuid) to authenticated;

create or replace function public.create_loan_proposal(
  p_chama_id uuid,
  p_amount numeric,
  p_title text,
  p_reason text,
  p_quorum numeric,
  p_repayment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_open int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount'; end if;

  select count(*) into v_open
  from public.proposals
  where chama_id = p_chama_id
    and requester_id = v_uid
    and type = 'loan'
    and status in ('active', 'approved', 'disbursed');

  if v_open > 0 then
    raise exception 'You already have an open loan facility. Settle it before requesting another.';
  end if;

  insert into public.proposals (
    chama_id, type, title, amount, requester_id, reason, status, quorum_threshold, repayment
  ) values (
    p_chama_id, 'loan', p_title, p_amount, v_uid, p_reason, 'active',
    coalesce(p_quorum, 0.6), p_repayment
  )
  returning id into v_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (p_chama_id, v_uid, 'vote', 'Loan proposal created: ' || p_title, p_amount);

  return public.list_chama_proposals(p_chama_id);
end;
$$;

grant execute on function public.create_loan_proposal(uuid, numeric, text, text, numeric, jsonb) to authenticated;

create or replace function public.cast_proposal_vote(
  p_proposal_id uuid,
  p_vote text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.proposals%rowtype;
  v_voter_count int;
  v_required int;
  v_approvals int;
  v_chama uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_vote not in ('approve', 'reject', 'abstain') then raise exception 'Invalid vote'; end if;

  select * into v_p from public.proposals where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if v_p.status <> 'active' then raise exception 'Proposal is not open for voting'; end if;
  if v_p.requester_id = v_uid then raise exception 'You cannot vote on your own application'; end if;
  if not public.is_chama_member(v_p.chama_id) then raise exception 'Not a member'; end if;

  v_chama := v_p.chama_id;

  insert into public.proposal_votes (proposal_id, voter_id, vote)
  values (p_proposal_id, v_uid, p_vote)
  on conflict (proposal_id, voter_id) do update set vote = excluded.vote, created_at = now();

  select count(*) into v_voter_count
  from public.chama_members m
  where m.chama_id = v_chama
    and m.status = 'active'
    and m.role <> 'New Applicant'
    and m.user_id <> v_p.requester_id;

  if v_voter_count < 1 then v_voter_count := 1; end if;
  v_required := ceil(v_voter_count * v_p.quorum_threshold);

  select count(*) into v_approvals
  from public.proposal_votes
  where proposal_id = p_proposal_id and vote = 'approve';

  if v_approvals >= v_required then
    update public.proposals set status = 'approved', updated_at = now() where id = p_proposal_id;
  end if;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (v_chama, v_uid, 'vote', 'Voted ' || p_vote || ' on ' || v_p.title, 0);

  return public.list_chama_proposals(v_chama);
end;
$$;

grant execute on function public.cast_proposal_vote(uuid, text) to authenticated;

create or replace function public.update_proposal_status(
  p_proposal_id uuid,
  p_status text,
  p_disbursement jsonb default null,
  p_repayment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.proposals%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_p from public.proposals where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if not public.is_chama_member(v_p.chama_id) then raise exception 'Not a member'; end if;

  if p_status = 'disbursed' then
    if not exists (
      select 1 from public.chama_members
      where chama_id = v_p.chama_id and user_id = v_uid
        and role = 'Treasurer' and status = 'active'
    ) then
      raise exception 'Only treasurer can disburse';
    end if;
  end if;

  update public.proposals set
    status = p_status,
    disbursement = coalesce(p_disbursement, disbursement),
    repayment = coalesce(p_repayment, repayment),
    disbursed_at = case when p_status = 'disbursed' then coalesce(disbursed_at, now()) else disbursed_at end,
    updated_at = now()
  where id = p_proposal_id;

  return public.list_chama_proposals(v_p.chama_id);
end;
$$;

grant execute on function public.update_proposal_status(uuid, text, jsonb, jsonb) to authenticated;

create or replace function public.list_chama_audit(p_chama_id uuid, p_limit int default 100)
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
      'id', e.id,
      'chamaId', e.chama_id,
      'memberId', e.member_id,
      'type', e.type,
      'description', e.description,
      'amount', e.amount,
      'reference', e.reference,
      'timestamp', e.created_at
    ) order by e.created_at desc)
    from (
      select * from public.audit_events
      where chama_id = p_chama_id
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) e
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.list_chama_audit(uuid, int) to authenticated;

create or replace function public.append_audit_event(
  p_chama_id uuid,
  p_type text,
  p_description text,
  p_amount numeric default 0,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_chama_member(p_chama_id) then raise exception 'Not a member'; end if;
  insert into public.audit_events (chama_id, member_id, type, description, amount, reference)
  values (p_chama_id, auth.uid(), p_type, p_description, coalesce(p_amount, 0), p_reference);
end;
$$;

grant execute on function public.append_audit_event(uuid, text, text, numeric, text) to authenticated;

create or replace function public.create_chama_invite(p_chama_id uuid, p_max_uses int default 50)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.chama_members
    where chama_id = p_chama_id and user_id = auth.uid()
      and role in ('Chairperson', 'Secretary') and status = 'active'
  ) then
    raise exception 'Only chairperson or secretary can create invites';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.chama_invites (chama_id, code, created_by, max_uses)
  values (p_chama_id, v_code, auth.uid(), coalesce(p_max_uses, 50));
  return v_code;
end;
$$;

grant execute on function public.create_chama_invite(uuid, int) to authenticated;
