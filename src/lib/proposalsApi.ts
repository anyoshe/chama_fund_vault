import { supabase } from "@/lib/supabase";
import type { AuditEvent, Proposal, VoteValue } from "@/types/chama";

function asProposalRows(data: unknown): Record<string, unknown>[] {
  let d: unknown = data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return [];
    }
  }
  if (Array.isArray(d)) return d as Record<string, unknown>[];
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data as Record<string, unknown>[];
  }
  return [];
}

function mapProposal(row: Record<string, unknown>): Proposal {
  return {
    id: String(row.id),
    chamaId: String(row.chamaId ?? row.chama_id ?? "").toLowerCase(),
    type: (row.type as Proposal["type"]) || "loan",
    title: String(row.title ?? ""),
    amount: Number(row.amount) || 0,
    requesterId: String(row.requesterId ?? row.requester_id ?? "").toLowerCase(),
    reason: String(row.reason ?? ""),
    requestedAt: String(row.requestedAt ?? row.requested_at ?? new Date().toISOString()),
    status: (row.status as Proposal["status"]) || "active",
    votes: (() => {
      const v = row.votes;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const out: Record<string, VoteValue> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[String(k).toLowerCase()] = val as VoteValue;
        }
        return out;
      }
      return {};
    })(),
    quorumThreshold: Number(row.quorumThreshold ?? row.quorum_threshold ?? 0.6),
    guarantorIds: ((row.guarantorIds as string[]) || []).map((x) => String(x).toLowerCase()),
    disbursedAt: row.disbursedAt
      ? String(row.disbursedAt)
      : row.disbursed_at
        ? String(row.disbursed_at)
        : undefined,
    disbursement: (row.disbursement as Proposal["disbursement"]) || undefined,
    repayment: (row.repayment as Proposal["repayment"]) || undefined,
  };
}

/** Prefer RPC; fall back to direct table read if RPC missing. */
export async function fetchChamaProposals(chamaId: string): Promise<Proposal[]> {
  const cid = String(chamaId).toLowerCase();

  const { data, error } = await supabase.rpc("list_chama_proposals", {
    p_chama_id: cid,
  });

  if (!error) {
    return asProposalRows(data).map((r) => mapProposal(r));
  }

  console.warn("list_chama_proposals RPC failed, trying table select", error.message);

  const { data: rows, error: qErr } = await supabase
    .from("proposals")
    .select(
      "id, chama_id, type, title, amount, requester_id, reason, status, quorum_threshold, guarantor_ids, requested_at, disbursed_at, repayment, disbursement",
    )
    .eq("chama_id", cid)
    .order("requested_at", { ascending: false });

  if (qErr) throw qErr;

  const list = (rows || []) as Record<string, unknown>[];
  // Load votes in one query
  const ids = list.map((r) => String(r.id));
  let voteMap: Record<string, Record<string, VoteValue>> = {};
  if (ids.length) {
    const { data: votes } = await supabase
      .from("proposal_votes")
      .select("proposal_id, voter_id, vote")
      .in("proposal_id", ids);
    for (const v of votes || []) {
      const pid = String((v as { proposal_id: string }).proposal_id).toLowerCase();
      const vid = String((v as { voter_id: string }).voter_id).toLowerCase();
      const vote = (v as { vote: VoteValue }).vote;
      if (!voteMap[pid]) voteMap[pid] = {};
      voteMap[pid][vid] = vote;
    }
  }

  return list.map((r) =>
    mapProposal({
      ...r,
      votes: voteMap[String(r.id).toLowerCase()] || {},
    }),
  );
}

export async function createLoanProposalOnServer(params: {
  chamaId: string;
  amount: number;
  title: string;
  reason: string;
  quorum: number;
  repayment: Proposal["repayment"];
}): Promise<Proposal[]> {
  const cid = String(params.chamaId).toLowerCase();
  // Ensure plain JSON (no undefined)
  const repayment =
    params.repayment == null
      ? null
      : JSON.parse(JSON.stringify(params.repayment));

  const { data, error } = await supabase.rpc("create_loan_proposal", {
    p_chama_id: cid,
    p_amount: params.amount,
    p_title: params.title,
    p_reason: params.reason,
    p_quorum: params.quorum,
    p_repayment: repayment,
  });

  if (error) {
    // Retry without repayment payload (some DBs reject large jsonb)
    const retry = await supabase.rpc("create_loan_proposal", {
      p_chama_id: cid,
      p_amount: params.amount,
      p_title: params.title,
      p_reason: params.reason,
      p_quorum: params.quorum,
      p_repayment: null,
    });
    if (retry.error) throw retry.error;
    // Patch repayment on the newest active loan if possible
    try {
      const rows = asProposalRows(retry.data).map((r) => mapProposal(r));
      const mine = rows.find((p) => p.status === "active");
      if (mine && repayment) {
        await supabase
          .from("proposals")
          .update({ repayment })
          .eq("id", mine.id);
        mine.repayment = params.repayment;
      }
      return rows.map((p) =>
        p.id === mine?.id ? { ...p, repayment: params.repayment } : p,
      );
    } catch {
      return asProposalRows(retry.data).map((r) => mapProposal(r));
    }
  }

  return asProposalRows(data).map((r) => mapProposal(r));
}

export async function castVoteOnServer(
  proposalId: string,
  vote: VoteValue,
): Promise<Proposal[]> {
  const { data, error } = await supabase.rpc("cast_proposal_vote", {
    p_proposal_id: proposalId,
    p_vote: vote,
  });
  if (error) throw error;
  return asProposalRows(data).map((r) => mapProposal(r));
}

export async function updateProposalOnServer(params: {
  proposalId: string;
  status: string;
  disbursement?: Proposal["disbursement"] | null;
  repayment?: Proposal["repayment"] | null;
}): Promise<Proposal[]> {
  const { data, error } = await supabase.rpc("update_proposal_status", {
    p_proposal_id: params.proposalId,
    p_status: params.status,
    p_disbursement: params.disbursement ?? null,
    p_repayment: params.repayment ?? null,
  });
  if (error) throw error;
  return asProposalRows(data).map((r) => mapProposal(r));
}

export async function fetchChamaAudit(chamaId: string): Promise<AuditEvent[]> {
  const { data, error } = await supabase.rpc("list_chama_audit", {
    p_chama_id: String(chamaId).toLowerCase(),
    p_limit: 150,
  });
  if (error) throw error;
  const rows = asProposalRows(data);
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    chamaId: String(r.chamaId ?? r.chama_id ?? "").toLowerCase(),
    memberId: String(r.memberId ?? r.member_id ?? "").toLowerCase(),
    type: r.type as AuditEvent["type"],
    description: String(r.description ?? ""),
    amount: Number(r.amount) || 0,
    timestamp: String(r.timestamp ?? r.created_at ?? new Date().toISOString()),
    reference: String(r.reference ?? r.id ?? ""),
  }));
}

export async function appendAudit(
  chamaId: string,
  type: string,
  description: string,
  amount = 0,
  reference?: string,
) {
  const { error } = await supabase.rpc("append_audit_event", {
    p_chama_id: String(chamaId).toLowerCase(),
    p_type: type,
    p_description: description,
    p_amount: amount,
    p_reference: reference ?? null,
  });
  if (error) console.error("append_audit_event", error);
}

/** Replace this chama's proposals with server rows only (no local-only loans/votes). */
export function mergeProposalsForChama(
  prev: Proposal[],
  chamaId: string,
  server: Proposal[],
): Proposal[] {
  const cid = String(chamaId).toLowerCase();
  const others = prev.filter((p) => String(p.chamaId).toLowerCase() !== cid);
  return [...server, ...others];
}
