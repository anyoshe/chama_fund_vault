import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { CheckCircle, PiggyBank, ShieldCheck, X } from "@phosphor-icons/react";
import Navbar from "@/components/Navbar";
import ChamaOverview from "@/components/ChamaOverview";
import GovernanceVoting from "@/components/GovernanceVoting";
import ContributionModal from "@/components/ContributionModal";
import LoansAndLedger from "@/components/LoansAndLedger";
import Members from "@/pages/Members";
import { useAuth } from "@/contexts/AuthContext";
import type {
  AuditEvent,
  Chama,
  Contribution,
  Member,
  Proposal,
  VoteValue,
} from "@/types/chama";
import {
  chamas as seedChamas,
  members as seedMembers,
  initialProposals,
  initialLedger,
  initialContributions,
  memberById,
  fmtKsh,
} from "@/data/mockChamaData";

const LS_KEY = "chamavault-state-v1";

interface PersistedState {
  contributions: Contribution[];
  proposals: Proposal[];
  ledger: AuditEvent[];
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(parsed.contributions) || !Array.isArray(parsed.proposals) || !Array.isArray(parsed.ledger)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

type Tab = "overview" | "voting" | "loans" | "members";

export default function Dashboard() {
  const { user, activeChamaId: authChamaId, setActiveChamaId: setAuthChamaId, logout } = useAuth();

  const realChamas: Chama[] = useMemo(() => {
    return (user?.memberships ?? [])
      .filter((m) => m.chama)
      .map((m) => {
        const c = m.chama!;
        return {
          id: c.id,
          name: c.name,
          tagline: c.tagline,
          kind: c.kind,
          memberCount: 0,
          poolBalance: Number(c.pool_balance) || 0,
          monthlyTarget: Number(c.monthly_target) || 0,
          monthCollected: Number(c.month_collected) || 0,
          constitution: c.constitution,
          nextPayout: { recipientName: "—", amount: 0, dueDate: "" },
          currency: c.currency || "KES",
        } satisfies Chama;
      });
  }, [user?.memberships]);

  const displayChamas = realChamas.length > 0 ? realChamas : seedChamas;

  const [activeChamaId, setActiveChamaIdLocal] = useState(
    () => authChamaId ?? displayChamas[0]?.id ?? seedChamas[0].id,
  );

  useEffect(() => {
    if (authChamaId) setActiveChamaIdLocal(authChamaId);
  }, [authChamaId]);

  const setActiveChamaId = (id: string) => {
    setActiveChamaIdLocal(id);
    setAuthChamaId(id);
  };

  const [currentMemberId, setCurrentMemberId] = useState(
    () => seedMembers.find((m) => m.isCurrentUser)?.id ?? seedMembers[0].id,
  );
  const [tab, setTab] = useState<Tab>("overview");
  const [contribOpen, setContribOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>(() => {
    const s = loadPersisted();
    return s ? s.contributions : initialContributions;
  });
  const [proposals, setProposals] = useState<Proposal[]>(() => {
    const s = loadPersisted();
    return s ? s.proposals : initialProposals;
  });
  const [ledger, setLedger] = useState<AuditEvent[]>(() => {
    const s = loadPersisted();
    return s ? s.ledger : initialLedger;
  });

  useEffect(() => {
    const s: PersistedState = { contributions, proposals, ledger };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked - non-fatal */
    }
  }, [contributions, proposals, ledger]);

  const chama = useMemo(
    () => displayChamas.find((c) => c.id === activeChamaId) ?? displayChamas[0] ?? seedChamas[0],
    [activeChamaId, displayChamas],
  );
  const currentMember = useMemo(
    () => memberById(currentMemberId, seedMembers),
    [currentMemberId],
  );

  const chamaLedger = useMemo(
    () =>
      ledger
        .filter((e) => e.chamaId === activeChamaId)
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
    [ledger, activeChamaId],
  );

  const unreadNotifications = useMemo(
    () => proposals.filter((p) => p.chamaId === activeChamaId && p.status === "active").length,
    [proposals, activeChamaId],
  );

  const nextRef = useMemo(() => {
    let n = 9000 + Math.floor(Math.random() * 900);
    return () => `CV-2025-${++n}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushAudit = (
    list: AuditEvent[],
    ev: Omit<AuditEvent, "id" | "chamaId" | "timestamp" | "reference">,
  ): AuditEvent[] => {
    const event: AuditEvent = {
      ...ev,
      id: `e-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      chamaId: activeChamaId,
      timestamp: new Date().toISOString(),
      reference: nextRef(),
    };
    return [event, ...list];
  };

  const handleContribute = (contribution: Contribution) => {
    setContributions((prev) => [contribution, ...prev]);
    setLedger((prev) =>
      pushAudit(prev, {
        memberId: contribution.memberId,
        type: "contribution",
        description: `Contribution via ${contribution.method}`,
        amount: contribution.amount,
      }),
    );
    toast.success("Contribution settled to group account", {
      description: `${fmtKsh(contribution.amount)} | ${contribution.method}`,
      icon: <CheckCircle className="text-emerald-400" />,
    });
  };

  const handleCastVote = (proposalId: string, vote: VoteValue) => {
    const target = proposals.find((p) => p.id === proposalId);
    if (!target) return;
    const nextVotes = { ...target.votes, [currentMemberId]: vote };
    const voterCount = seedMembers.filter((m) => m.role !== "New Applicant").length || 1;
    const required = Math.ceil(voterCount * target.quorumThreshold);
    const approvals = Object.values(nextVotes).filter((v) => v === "approve").length;
    const passed = target.status === "active" && approvals >= required;

    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        const updated: Proposal = { ...p, votes: nextVotes, status: passed ? "approved" : p.status };
        return passed ? { ...updated, disbursedAt: new Date().toISOString() } : updated;
      }),
    );
    setLedger((prev) =>
      pushAudit(prev, {
        memberId: currentMemberId,
        type: "vote",
        description: `Voted ${vote} on proposal ${proposalId}`,
        amount: 0,
      }),
    );
    if (passed) {
      toast.success("Quorum reached - motion approved & auto-executed", {
        description: `${target.title} | ${fmtKsh(target.amount)}`,
        icon: <ShieldCheck className="text-emerald-400" />,
      });
    }
  };

  const handleRepay = (proposalId: string) => {
    const target = proposals.find((p) => p.id === proposalId);
    if (!target || !target.repayment) return;
    const today = new Date().toISOString().slice(0, 10);
    const firstUnpaid = target.repayment.schedule.findIndex((x) => !x.paid);
    const schedule = target.repayment.schedule.map((pmt, i) =>
      !pmt.paid && pmt.dueDate <= today && i === firstUnpaid ? { ...pmt, paid: true } : pmt,
    );
    const allPaid = schedule.every((pmt) => pmt.paid);
    const paidAmount = schedule.filter((pmt) => pmt.paid).reduce((s, pmt) => s + pmt.amount, 0);
    const existingPaid = target.repayment.schedule
      .filter((pmt) => pmt.paid)
      .reduce((s, pmt) => s + pmt.amount, 0);
    setProposals((prev) =>
      prev.map((p) =>
        p.id !== proposalId
          ? p
          : {
              ...p,
              repayment: { ...p.repayment!, schedule },
              status: allPaid ? "settled" : p.status,
            },
      ),
    );
    setLedger((prev) =>
      pushAudit(prev, {
        memberId: target.requesterId,
        type: "repayment",
        description: allPaid ? "Loan fully settled" : `Repayment installment for ${proposalId}`,
        amount: paidAmount - existingPaid,
      }),
    );
    toast.success("Repayment recorded - funds returned to group pool");
  };

  const handleProposeLoan = () => {
    setTab("voting");
    toast.info("New loan request drafts appear on the Voting Board", {
      description: "Every disbursal needs quorum approval - no cash handling.",
    });
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "voting", label: "Voting Board" },
    { id: "loans", label: "Loans & Ledger" },
    { id: "members", label: "Members" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar
        chamas={displayChamas}
        activeChamaId={activeChamaId}
        members={seedMembers}
        currentMemberId={currentMemberId}
        unreadNotifications={unreadNotifications}
        onSwitchChama={(id) => {
          setActiveChamaId(id);
          setTab("overview");
        }}
        onSwitchMember={setCurrentMemberId}
        onOpenNotifications={() => setNotifOpen((v) => !v)}
        onLogout={logout}
        currentUserName={user?.profile?.full_name ?? user?.email}
      />

      {/* Tab rail */}
      <div className="sticky top-16 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                className={`relative whitespace-nowrap px-4 py-3 text-sm font-semibold transition ${
                  active ? "text-white" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t.label}
                {t.id === "voting" && unreadNotifications > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-slate-950">
                    {unreadNotifications}
                  </span>
                )}
                {active && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-emerald-400"
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {tab === "overview" && (
              <ChamaOverview
                chama={chama}
                members={seedMembers}
                proposals={proposals}
                currentMemberId={currentMemberId}
                onContribute={() => setContribOpen(true)}
                onProposeLoan={handleProposeLoan}
              />
            )}
            {tab === "voting" && (
              <GovernanceVoting
                chamaId={activeChamaId}
                members={seedMembers}
                proposals={proposals}
                currentMemberId={currentMemberId}
                onCastVote={handleCastVote}
              />
            )}
            {tab === "loans" && (
              <LoansAndLedger
                chamaId={activeChamaId}
                members={seedMembers}
                proposals={proposals}
                ledger={chamaLedger}
                onRepay={handleRepay}
              />
            )}
            {tab === "members" && <Members />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Notifications drawer */}
      <AnimatePresence>
        {notifOpen && (
          <>
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-label="Close notifications"
              onClick={() => setNotifOpen(false)}
              className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: "easeInOut" }}
              className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-slate-800 bg-slate-900 shadow-2xl shadow-black/60"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-white">Notifications</h3>
                  <p className="text-[11px] text-slate-400">Voting alerts for {chama.name}</p>
                </div>
                <button
                  onClick={() => setNotifOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                  aria-label="Close"
                >
                  <X size={17} />
                </button>
              </div>
              <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
                {proposals
                  .filter((p) => p.chamaId === activeChamaId)
                  .slice(0, 8)
                  .map((p) => {
                    const requester = memberById(p.requesterId, seedMembers);
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border p-3 ${
                          p.status === "active"
                            ? "border-amber-400/25 bg-amber-400/5"
                            : "border-slate-800 bg-slate-950/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-slate-200">{p.title}</p>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              p.status === "active"
                                ? "bg-amber-400/15 text-amber-300"
                                : p.status === "approved" || p.status === "disbursed"
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {p.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {requester.name} | {fmtKsh(p.amount)}
                        </p>
                      </div>
                    );
                  })}
                {proposals.filter((p) => p.chamaId === activeChamaId).length === 0 && (
                  <div className="flex flex-col items-center py-10 text-center">
                    <PiggyBank size={26} className="text-slate-600" />
                    <p className="mt-2 text-xs text-slate-500">No alerts for this Chama yet.</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-slate-800 px-5 py-3 text-[11px] text-slate-500">
                <ShieldCheck size={13} className="text-emerald-500" />
                All approvals are logged to the tamper-proof audit trail.
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <ContributionModal
        open={contribOpen}
        onClose={() => setContribOpen(false)}
        chama={chama}
        currentMember={currentMember}
        onSubmit={handleContribute}
      />

      <footer className="border-t border-slate-800/80 py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-center sm:flex-row sm:px-6 sm:text-left">
          <p className="text-xs text-slate-500">
            (c) 2025 ChamaVault | Zero-cash treasury - money moves by rail, governance by quorum.
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <ShieldCheck size={13} className="text-emerald-500" />
            STK Push | EFT/RTGS | Immutable ledger
          </p>
        </div>
      </footer>
    </div>
  );
}