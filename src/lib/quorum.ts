/**
 * Quorum helpers — keep Overview, Voting Board, and cast-vote in sync.
 *
 * Eligible voters = all members except "New Applicant" and the motion requester
 * (applicant cannot vote on their own loan).
 *
 * Required approvals = at least `quorumPercent` of eligible voters.
 * Threshold may be stored as 0.6 or 60 — both are accepted.
 */
export function normalizeQuorumThreshold(raw: number | null | undefined): number {
  if (raw == null || Number.isNaN(Number(raw))) return 0.6;
  const n = Number(raw);
  // 60 → 0.6 ; 0.6 stays 0.6
  if (n > 1) return Math.min(1, n / 100);
  if (n <= 0) return 0.6;
  return n;
}

export function countEligibleVoters(
  members: { id: string; role?: string }[],
  requesterId: string,
): number {
  const n = members.filter(
    (m) => m.role !== "New Applicant" && m.id !== requesterId,
  ).length;
  return Math.max(1, n);
}

export function requiredApprovals(
  members: { id: string; role?: string }[],
  requesterId: string,
  quorumThreshold: number | null | undefined,
): number {
  const eligible = countEligibleVoters(members, requesterId);
  const t = normalizeQuorumThreshold(quorumThreshold);
  // Nearest whole number of votes (5 × 60% = 3, not 4)
  // Use round so 60% of 5 → 3; avoid ceil(3.0 + epsilon) quirks
  const need = Math.round(eligible * t);
  return Math.min(eligible, Math.max(1, need));
}

export function countApprovals(votes: Record<string, string> | null | undefined): number {
  if (!votes) return 0;
  return Object.values(votes).filter((v) => v === "approve").length;
}

export function approvalsStillNeeded(
  members: { id: string; role?: string }[],
  requesterId: string,
  quorumThreshold: number | null | undefined,
  votes: Record<string, string> | null | undefined,
): number {
  return Math.max(
    0,
    requiredApprovals(members, requesterId, quorumThreshold) -
      countApprovals(votes),
  );
}
