import { useState } from "react";
import {
  HandCoins,
  Prohibit,
  Scales,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  UserSwitch,
  UsersFour,
  Wallet,
  WarningCircle,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { Member, Proposal, VoteValue } from "../types/chama";
import { fmtKsh, memberById } from "../data/mockChamaData";

interface GovernanceVotingProps {
  chamaId: string;
  members: Member[];
  proposals: Proposal[];
  currentMemberId: string;
  onCastVote: (proposalId: string, vote: VoteValue) => void;
}

const TYPE_META: Record<
  Proposal["type"],
  { label: string; chip: string; icon: React.ReactNode }
> = {
  loan: { label: "Loan", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: <HandCoins size={13} /> },
  withdrawal: { label: "Withdrawal", chip: "bg-amber-400/15 text-amber-300 border-amber-400/30", icon: <Wallet size={13} /> },
  payout: { label: "Payout", chip: "bg-sky-500/15 text-sky-300 border-sky-500/30", icon: <Scales size={13} /> },
  investment: { label: "Investment", chip: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: <Scales size={13} /> },
};

export default function GovernanceVoting({
  chamaId,
  members,
  proposals,
  currentMemberId,
  onCastVote,
}: GovernanceVotingProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = proposals.filter((p) => p.chamaId === chamaId && p.status === "active");

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-white">Quorum Voting Board</h2>
          <p className="text-xs text-slate-400">
            Every loan & withdrawal needs {">"}={""} 60% member approval before funds move — by design.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-bold text-amber-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          {active.length} active
        </span>
      </div>

      {active.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 py-12 text-center">
          <ShieldCheck size={32} className="text-emerald-500" />
          <p className="mt-3 text-sm font-semibold text-slate-300">No motions awaiting your vote</p>
          <p className="mt-1 text-xs text-slate-500">New loan or withdrawal requests appear here for quorum voting.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {active.map((p) => {
            const requester = memberById(p.requesterId, members);
            const voterCount = members.filter((m) => m.role !== "New Applicant").length || 1;
            const required = Math.ceil(voterCount * p.quorumThreshold);
            const approvals = Object.values(p.votes).filter((v) => v === "approve").length;
            const rejections = Object.values(p.votes).filter((v) => v === "reject").length;
            const progress = Math.min(100, Math.round((approvals / required) * 100));
            const passed = approvals >= required;
            const myVote = p.votes[currentMemberId];
            const meta = TYPE_META[p.type];
            const open = openId === p.id;

            return (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-lg shadow-black/20"
              >
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
                          {meta.icon} {meta.label}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">#{p.id.slice(1)}</span>
                      </div>
                      <h3 className="mt-2 text-sm font-bold leading-snug text-white">{p.title}</h3>
                    </div>
                    <span className="shrink-0 font-mono text-lg font-bold tabular-nums text-emerald-300">
                      {fmtKsh(p.amount)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold text-white"
                        style={{
                          background: `linear-gradient(135deg, hsl(${requester.avatarHue} 65% 42%), hsl(${(requester.avatarHue + 40) % 360} 70% 30%))`,
                        }}
                      >
                        {requester.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </span>
                      {requester.name}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>{new Date(p.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    {p.guarantorIds && p.guarantorIds.length > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-violet-300">
                        <UsersFour size={11} /> {p.guarantorIds.length} guarantors
                      </span>
                    )}
                  </div>

                  {/* Quorum progress */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Approvals {approvals}/{required} required
                      </span>
                      <span className={`font-mono font-bold ${passed ? "text-emerald-400" : "text-amber-300"}`}>
                        {progress}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.7, ease: "easeOut" }}
                        className={`h-full rounded-full ${passed ? "bg-emerald-500" : "bg-gradient-to-r from-amber-400 to-orange-400"}`}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {passed
                        ? "✓ Quorum reached — funds will auto-execute"
                        : rejections > 0
                          ? `${rejections} member(s) rejected — motion still in play`
                          : "Waiting for the remaining votes before auto-execution"}
                    </p>
                  </div>

                  {/* Vote buttons */}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <VoteButton
                      value="approve"
                      myVote={myVote}
                      onClick={() => {
                        onCastVote(p.id, "approve");
                        toast.success("Vote cast — Approve", { description: p.title });
                      }}
                    />
                    <VoteButton
                      value="reject"
                      myVote={myVote}
                      reject
                      onClick={() => {
                        onCastVote(p.id, "reject");
                        toast("Vote cast — Reject", { description: p.title });
                      }}
                    />
                  </div>

                  <button
                    onClick={() => setOpenId(open ? null : p.id)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-800 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                  >
                    {open ? "Hide" : "Show"} details & reason
                    <CaretDownMini open={open} />
                  </button>
                </div>

                <AnimatePresence>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="overflow-hidden border-t border-slate-800"
                    >
                      <div className="space-y-3 bg-slate-950/50 p-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reason</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-300">{p.reason}</p>
                        </div>
                        {p.guarantorIds && p.guarantorIds.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Guarantors pledged
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {p.guarantorIds.map((gid) => {
                                const g = memberById(gid, members);
                                return (
                                  <span
                                    key={gid}
                                    className="flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200"
                                  >
                                    <UserSwitch size={12} /> {g.name}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Cast votes ({approvals + rejections}/{voterCount} eligible)
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {members
                              .filter((m) => m.role !== "New Applicant")
                              .map((m) => {
                                const v = p.votes[m.id];
                                return (
                                  <span
                                    key={m.id}
                                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                      v === "approve"
                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                        : v === "reject"
                                          ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                                          : v === "abstain"
                                            ? "border-slate-600 bg-slate-800/60 text-slate-400"
                                            : "border-slate-800 bg-slate-900 text-slate-600"
                                    }`}
                                  >
                                    {v === "approve" ? <ThumbsUp size={10} weight="fill" /> : v === "reject" ? <ThumbsDown size={10} weight="fill" /> : v === "abstain" ? <Prohibit size={10} /> : <WarningCircle size={10} />}
                                    {m.name.split(" ")[0]} · {v ?? "not voted"}
                                  </span>
                                );
                              })}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function VoteButton({
  value,
  myVote,
  reject,
  onClick,
}: {
  value: VoteValue;
  myVote?: VoteValue;
  reject?: boolean;
  onClick: () => void;
}) {
  const selected = myVote === value;
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition active:scale-[0.98] ${
        selected
          ? reject
            ? "border-rose-500/60 bg-rose-500/15 text-rose-300"
            : "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
          : reject
            ? "border-slate-700 bg-slate-900 text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
            : "border-slate-700 bg-slate-900 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300"
      }`}
    >
      {reject ? <ThumbsDown size={15} weight={selected ? "fill" : "regular"} /> : <ThumbsUp size={15} weight={selected ? "fill" : "regular"} />}
      {selected ? "Voted" : reject ? "Reject" : "Approve"}
    </button>
  );
}

function CaretDownMini({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}