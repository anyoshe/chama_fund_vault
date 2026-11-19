-- ============================================================
-- Fix: loan applications not visible on Vote / Loans applied
-- Run once in Supabase SQL Editor
-- ============================================================

-- Ensure membership helper exists (used by list/create)
create or replace function public.is_chama_member(p_chama_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chama_members m
    where m.chama_id = p_chama_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  );
$$;

grant execute on function public.is_chama_member(uuid) to authenticated;

-- Recreate list (returns camelCase keys for the app)
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
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;

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
      'reason', coalesce(p.reason, ''),
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

-- Recreate create (clearer errors; always returns full list)
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
  if not public.is_chama_member(p_chama_id) then
    raise exception 'Not a member of this chama';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

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
    p_chama_id, 'loan', coalesce(nullif(trim(p_title), ''), 'Loan request'),
    p_amount, v_uid, coalesce(p_reason, ''), 'active',
    coalesce(p_quorum, 0.6), p_repayment
  )
  returning id into v_id;

  insert into public.audit_events (chama_id, member_id, type, description, amount)
  values (
    p_chama_id, v_uid, 'vote',
    'Loan proposal created: ' || coalesce(p_title, 'Loan'),
    p_amount
  );

  return public.list_chama_proposals(p_chama_id);
end;
$$;

grant execute on function public.create_loan_proposal(uuid, numeric, text, text, numeric, jsonb) to authenticated;

-- RLS: members can read proposals & votes
alter table public.proposals enable row level security;
alter table public.proposal_votes enable row level security;

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

-- Optional: see what's stored (run as check)
-- select id, title, status, amount, requester_id, chama_id from public.proposals order by requested_at desc limit 20;
