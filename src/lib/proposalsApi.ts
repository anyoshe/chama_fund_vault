import { supabase } from "@/lib/supabase";
import type { AuditEvent, Proposal, VoteValue } from "@/types/chama";

function mapProposal(row: Record<string, unknown>): Proposal {
  return {
    id: String(row.id),
    chamaId: String(row.chamaId ?? row.chama_id),
    type: (row.type as Proposal["type"]) || "loan",
    title: String(row.title ?? ""),
    amount: Number(row.amount) || 0,
    requesterId: String(row.requesterId ?? row.requester_id),
    reason: String(row.reason ?? ""),
    requestedAt: String(row.requestedAt ?? row.requested_at ?? new Date().toISOString()),
    status: (row.status as Proposal["status"]) || "active",
    votes: (() => {
      const v = row.votes;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, VoteValue>;
      }
      return {};
    })(),
    quorumThreshold: Number(row.quorumThreshold ?? row.quorum_threshold ?? 0.6),
    guarantorIds: (row.guarantorIds as string[]) || [],
    disbursedAt: row.disbursedAt
      ? String(row.disbursedAt)
      : row.disbursed_at
        ? String(row.disbursed_at)
        : undefined,
    disbursement: (row.disbursement as Proposal["disbursement"]) || undefined,
    repayment: (row.repayment as Proposal["repayment"]) || undefined,
  };
}

export async function fetchChamaProposals(chamaId: string): Promise<Proposal[]> {
  const { data, error } = await supabase.rpc("list_chama_proposals", {
    p_chama_id: chamaId,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => mapProposal(r as Record<string, unknown>));
}

export async function createLoanProposalOnServer(params: {
  chamaId: string;
  amount: number;
  title: string;
  reason: string;
  quorum: number;
  repayment: Proposal["repayment"];
}): Promise<Proposal[]> {
  const { data, error } = await supabase.rpc("create_loan_proposal", {
    p_chama_id: params.chamaId,
    p_amount: params.amount,
    p_title: params.title,
    p_reason: params.reason,
    p_quorum: params.quorum,
    p_repayment: params.repayment ?? null,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => mapProposal(r as Record<string, unknown>));
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
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => mapProposal(r as Record<string, unknown>));
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
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => mapProposal(r as Record<string, unknown>));
}

export async function fetchChamaAudit(chamaId: string): Promise<AuditEvent[]> {
  const { data, error } = await supabase.rpc("list_chama_audit", {
    p_chama_id: chamaId,
    p_limit: 150,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    chamaId: String(r.chamaId ?? r.chama_id),
    memberId: String(r.memberId ?? r.member_id ?? ""),
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
    p_chama_id: chamaId,
    p_type: type,
    p_description: description,
    p_amount: amount,
    p_reference: reference ?? null,
  });
  if (error) console.error("append_audit_event", error);
}
