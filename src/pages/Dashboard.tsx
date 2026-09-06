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
import { supabase } from "@/lib/supabase";
import type { ChamaKit,
  AuditEvent,
  Chama,
  Contribution,
  Member,
  Proposal,
  VoteValue,
} from "@/types/chama";
import {
  chamas as seedChamas,
  initialProposals,
  initialLedger,
  initialContributions,
  fmtKsh,
} from "@/data/mockChamaData";

const LS_KEY = "chamavault-state-v1";

/** Flat % of principal per month, for each month of the term */
function buildFlatMonthlySchedule(principal: number, months: number, monthlyRatePct = 10) {
  const monthlyInterest = principal * (monthlyRatePct / 100);
  const totalInterest = monthlyInterest * months;
  const totalRepay = principal + totalInterest;
  const installment = months > 0 ? totalRepay / months : totalRepay;
  const principalPart = months > 0 ? principal / months : principal;
  const interestPart = months > 0 ? totalInterest / months : totalInterest;
  const start = new Date();
  const schedule = Array.from({ length: months }, (_, i) => {
    const due = new Date(start);
    due.setMonth(due.getMonth() + i + 1);
    return {
      dueDate: due.toISOString().slice(0, 10),
      amount: Math.round(installment * 100) / 100,
      paid: false,
    };
  });
  return {
    interestRate: monthlyRatePct,
    interestModel: "flat" as const,
    installments: months,
    monthlyInterest: Math.round(monthlyInterest * 100) / 100,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalRepay: Math.round(totalRepay * 100) / 100,
    installmentAmount: Math.round(installment * 100) / 100,
    schedule,
  };
}


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
  const {
    user,
    activeChamaId: authChamaId,
    setActiveChamaId: setAuthChamaId,
    resetPassword,
    logout,
  } = useAuth();

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

  // Never show demo placeholders when the user is signed in
  const displayChamas = realChamas;
  const usingDemoData = false;

  const [activeChamaId, setActiveChamaIdLocal] = useState(
    () => authChamaId ?? displayChamas[0]?.id ?? "",
  );
  const [displayMembers, setDisplayMembers] = useState<Member[]>([]);
  const [kits, setKits] = useState<ChamaKit[]>([]);

  useEffect(() => {
    if (!activeChamaId) {
      setDisplayMembers([]);
      setKits([]);
      return;
    }
    let cancelled = false;
    const loadMembers = async () => {
      const [{ data: memberRows, error: membersError }, { data: profiles }, { data: contributionRows, error: contributionsError }, { data: kitRows, error: kitsError }] = await Promise.all([
        supabase.rpc("list_chama_members", { p_chama_id: activeChamaId }),
        supabase.rpc("list_chama_profiles", { p_chama_id: activeChamaId }),
        supabase
          .from("contributions")
          .select("id, chama_id, member_id, amount, destination, method, phone, payment_details, reference, status, created_at, confirmed_at")
          .eq("chama_id", activeChamaId)
          .order("created_at", { ascending: false }),
        supabase.rpc("list_chama_kits", { p_chama_id: activeChamaId }),
      ]);
      if (kitsError) {
        console.error("loadDashboardKits", kitsError);
        setKits([]);
      } else {
        setKits(
          (kitRows ?? []).map((k) => ({
            ...k,
            balance: Number(k.balance) || 0,
          })) as ChamaKit[],
        );
      }
      if (cancelled || membersError) {
        if (membersError) console.error("loadDashboardMembers", membersError);
        return;
      }
      const profileMap = new Map(
        (profiles ?? []).map((profile) => [profile.id, profile]),
      );
      setDisplayMembers(
        (memberRows ?? []).map((membership) => {
          const profile = profileMap.get(membership.user_id);
          return {
            id: membership.user_id,
            name: profile?.full_name ?? "Unknown member",
            phone: profile?.phone ?? "",
            role: membership.role as Member["role"],
            avatarHue: profile?.avatar_hue ?? 150,
            joinedAt: membership.joined_at,
            monthlyContribution: Number(membership.monthly_contribution) || 0,
            totalPaid: Number(membership.total_paid) || 0,
            activeLoans: Number(membership.active_loans) || 0,
            isCurrentUser: membership.user_id === user?.id,
          };
        }),
      );
      if (contributionsError) {
        console.error("loadDashboardContributions", contributionsError);
      } else {
        const loadedContributions: Contribution[] = (contributionRows ?? []).map((row) => ({
          id: row.id,
          memberId: row.member_id,
          chamaId: row.chama_id,
          amount: Number(row.amount),
          destination: row.destination as Contribution["destination"],
          method: row.method as Contribution["method"],
          paymentDetails: row.payment_details ?? row.phone ?? undefined,
          reference: row.reference,
          status: row.status as Contribution["status"],
          date: row.confirmed_at ?? row.created_at,
          confirmedAt: row.confirmed_at ?? undefined,
        }));
        setContributions((previous) => [
          ...previous.filter((contribution) => contribution.chamaId !== activeChamaId),
          ...loadedContributions,
        ]);
        setLedger((previous) => [
          ...previous.filter((event) => event.chamaId !== activeChamaId || event.type !== "contribution"),
          ...loadedContributions.map((saved) => ({
            id: `e-${saved.id}`,
            chamaId: saved.chamaId,
            memberId: saved.memberId,
            type: "contribution" as const,
            description: `Contribution to ${saved.destination} via ${saved.method}${saved.paymentDetails ? ` (${saved.paymentDetails})` : ""}`,
            amount: saved.amount,
            timestamp: saved.date,
            reference: saved.reference,
          })),
        ]);
      }
    };
    void loadMembers();
    return () => {
      cancelled = true;
    };
  }, [activeChamaId, user?.id]);

  useEffect(() => {
    if (authChamaId) setActiveChamaIdLocal(authChamaId);
  }, [authChamaId]);

  const setActiveChamaId = (id: string) => {
    setActiveChamaIdLocal(id);
    setAuthChamaId(id);
  };

  const [currentMemberId, setCurrentMemberId] = useState(
    () => user?.id ?? "",
  );
  useEffect(() => {
    if (user?.id) setCurrentMemberId(user.id);
  }, [user?.id]);
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
    () => displayChamas.find((c) => c.id === activeChamaId) ?? displayChamas[0],
    [activeChamaId, displayChamas],
  );
  const currentMember = useMemo(
    () => displayMembers.find((member) => member.id === currentMemberId) ?? displayMembers[0],
    [currentMemberId, displayMembers],
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

  const handleContribute = async (contribution: Contribution) => {
    const { data, error } = await supabase.rpc("record_contribution", {
      p_chama_id: contribution.chamaId,
      p_amount: contribution.amount,
      p_destination: contribution.destination ?? "general-savings",
      p_method: contribution.method,
      p_phone: contribution.method === "M-Pesa STK Push" || contribution.method === "Airtel Money"
        ? contribution.paymentDetails
        : null,
      p_payment_details: contribution.method === "M-Pesa STK Push" || contribution.method === "Airtel Money"
        ? null
        : contribution.paymentDetails,
      p_reference: contribution.reference,
    });
    if (error) throw error;
    if (!data) throw new Error("The payment was confirmed but no record was returned.");

    const saved: Contribution = {
      ...contribution,
      id: data.id,
      date: data.confirmed_at ?? data.created_at,
      confirmedAt: data.confirmed_at ?? undefined,
      status: data.status,
    };
    const { data: membership, error: membershipError } = await supabase
      .from("chama_members")
      .select("total_paid")
      .eq("chama_id", saved.chamaId)
      .eq("user_id", saved.memberId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    setContributions((prev) => [saved, ...prev]);
    setDisplayMembers((prev) =>
      prev.map((member) =>
        member.id === saved.memberId
          ? { ...member, totalPaid: membership ? Number(membership.total_paid) : member.totalPaid + saved.amount }
          : member,
      ),
    );
    setLedger((prev) =>
      [{
        id: `e-${saved.id}`,
        chamaId: saved.chamaId,
        memberId: saved.memberId,
        type: "contribution",
        description: `Contribution to ${saved.destination} via ${saved.method}${saved.paymentDetails ? ` (${saved.paymentDetails})` : ""}`,
        amount: saved.amount,
        timestamp: saved.date,
        reference: saved.reference,
      }, ...prev],
    );
  };

  const handleCastVote = (proposalId: string, vote: VoteValue) => {
    const target = proposals.find((p) => p.id === proposalId);
    if (!target) return;
    const nextVotes = { ...target.votes, [currentMemberId]: vote };
    const voterCount = displayMembers.filter((m) => m.role !== "New Applicant").length || 1;
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
      void (async () => {
        const { data, error } = await supabase.rpc("disburse_from_loan_fund", {
          p_chama_id: activeChamaId,
          p_amount: target.amount,
          p_borrower_id: target.requesterId,
          p_reference: `DISB-${target.id}`,
        });
        if (error) {
          console.error(error);
          toast.error(error.message || "Approved, but loan fund could not disburse.");
          setProposals((prev) =>
            prev.map((p) => (p.id === proposalId ? { ...p, status: "approved" as const } : p)),
          );
          return;
        }
        setProposals((prev) =>
          prev.map((p) =>
            p.id === proposalId
              ? {
                  ...p,
                  status: "disbursed" as const,
                  disbursedAt: new Date().toISOString(),
                }
              : p,
          ),
        );
        const { data: kitRows } = await supabase.rpc("list_chama_kits", {
          p_chama_id: activeChamaId,
        });
        if (kitRows) {
          setKits(
            kitRows.map((k: ChamaKit) => ({
              ...k,
              balance: Number(k.balance) || 0,
            })),
          );
        }
        toast.success("Quorum reached — paid from loaning pool", {
          description: `${target.title} | ${fmtKsh(target.amount)}`,
          icon: <ShieldCheck className="text-emerald-400" />,
        });
        void data;
      })();
    }
  };

  const handleRepay = async (proposalId: string) => {
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
    const repaid = paidAmount - existingPaid;
    if (repaid > 0 && activeChamaId) {
      const { error: repayError } = await supabase.rpc("credit_loan_fund", {
        p_chama_id: activeChamaId,
        p_amount: repaid,
        p_reference: `REPAY-${proposalId}-${Date.now()}`,
      });
      if (repayError) {
        console.error(repayError);
        toast.error(repayError.message || "Schedule updated, but loan fund was not credited.");
        return;
      }
      const { data: kitRows } = await supabase.rpc("list_chama_kits", {
        p_chama_id: activeChamaId,
      });
      if (kitRows) {
        setKits(
          kitRows.map((k: ChamaKit) => ({
            ...k,
            balance: Number(k.balance) || 0,
          })),
        );
      }
    }
    toast.success("Repayment recorded — returned to the loaning pool (liquidity kits)");
  };


  const handleReschedule = (
    proposalId: string,
    repayment: import("@/types/chama").LoanRepaymentPlan,
    meta: { mode: "early" | "extend"; settleAmount?: number },
  ) => {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id !== proposalId) return p;
        if (meta.mode === "early") {
          return {
            ...p,
            repayment,
            status: "settled" as const,
          };
        }
        return {
          ...p,
          repayment,
          status: p.status === "settled" ? p.status : p.status,
        };
      }),
    );
    setLedger((prev) =>
      pushAudit(prev, {
        memberId: user?.id ?? "system",
        type: "repayment",
        description:
          meta.mode === "early"
            ? `Early settlement on ${proposalId}${meta.settleAmount != null ? ` · ${fmtKsh(meta.settleAmount)}` : ""}`
            : `Loan term extended / recalculated on ${proposalId}`,
        amount: meta.settleAmount ?? 0,
      }),
    );
    if (meta.mode === "early" && meta.settleAmount && activeChamaId) {
      void supabase.rpc("credit_loan_fund", {
        p_chama_id: activeChamaId,
        p_amount: meta.settleAmount,
        p_reference: `EARLY-${proposalId}-${Date.now()}`,
      }).then(({ error }) => {
        if (error) toast.error(error.message);
        else toast.success("Early settlement recorded — loaning pool credited");
      });
    } else if (meta.mode === "extend") {
      toast.success("Repayment schedule updated");
    }
  };

  const handleProposeLoan = async () => {
    if (!activeChamaId || !user?.id) {
      toast.error("Select a chama and sign in first.");
      return;
    }

    const raw = window.prompt("Loan amount (KES)?");
    if (raw == null) return;
    const amount = Number(String(raw).replace(/[,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid amount greater than zero.");
      return;
    }

    const defaultRate = chama?.constitution?.loanInterestMonthlyPercent ?? 10;
    const rateOptions = chama?.constitution?.loanInterestOptions?.length
      ? chama.constitution.loanInterestOptions
      : [{ label: "Standard", monthlyPercent: defaultRate }];

    let monthlyRate = defaultRate;
    if (rateOptions.length === 1) {
      monthlyRate = rateOptions[0].monthlyPercent;
    } else {
      const menu = rateOptions
        .map((o, i) => `${i + 1}. ${o.label} (${o.monthlyPercent}% / month flat)`)
        .join("\n");
      const pick = window.prompt(
        `Choose interest rate for this loan:\n${menu}\n\nEnter number 1-${rateOptions.length}`,
        "1",
      );
      if (pick == null) return;
      const idx = Math.max(1, Math.min(rateOptions.length, Math.floor(Number(pick) || 1))) - 1;
      monthlyRate = rateOptions[idx].monthlyPercent;
    }

    const termRaw = window.prompt(
      `How many monthly installments? (1–24)\nInterest: ${monthlyRate}% of principal per month flat.`,
      "3",
    );
    if (termRaw == null) return;
    const months = Math.max(1, Math.min(24, Math.floor(Number(termRaw) || 0)));
    if (!months) {
      toast.error("Enter a valid number of installments.");
      return;
    }

    const plan = buildFlatMonthlySchedule(amount, months, monthlyRate);

    const { data: limitRows, error: limitError } = await supabase.rpc("get_member_loan_limit", {
      p_chama_id: activeChamaId,
      p_user_id: user.id,
    });
    if (limitError) {
      console.error(limitError);
      toast.error(limitError.message || "Could not load your loan limit. Run kits SQL in Supabase.");
      return;
    }
    const limit = Array.isArray(limitRows) ? limitRows[0] : limitRows;
    const maxLoan = Number(limit?.max_loan ?? 0);
    const shares = Number(limit?.share_balance ?? 0);
    const fund = Number(limit?.loan_fund_balance ?? 0);
    const mult = Number(limit?.max_multiple ?? 3);

    if (shares <= 0) {
      toast.error("You have no share balance yet. Contribute to table banking, share capital, or general savings first.");
      return;
    }
    if (amount > maxLoan) {
      toast.error(
        `Max you can request is ${fmtKsh(maxLoan)} (${mult}× your shares of ${fmtKsh(shares)}).`,
      );
      return;
    }
    if (amount > fund) {
      toast.error(
        `Loaning pool only has ${fmtKsh(fund)}. Add to table banking, share capital, general savings or member-loans — or request less.`,
      );
      return;
    }

    const id = `loan-${Date.now()}`;
    const title = `Loan request · ${fmtKsh(amount)}`;
    const quorumThreshold = (chama?.constitution?.quorumPercent ?? 60) / 100;
    const newProposal: Proposal = {
      id,
      chamaId: activeChamaId,
      type: "loan",
      requesterId: user.id,
      title,
      reason: `Principal ${fmtKsh(amount)}. ${months} months × ${monthlyRate}% flat = ${fmtKsh(plan.monthlyInterest)}/mo interest. Total repay ${fmtKsh(plan.totalRepay)} (${fmtKsh(plan.installmentAmount)} × ${months}). Shares ${fmtKsh(shares)}.`,
      amount,
      status: "active",
      quorumThreshold,
      votes: {},
      requestedAt: new Date().toISOString(),
      repayment: {
        interestRate: plan.interestRate,
        interestModel: plan.interestModel,
        installments: plan.installments,
        schedule: plan.schedule,
      },
    };

    setProposals((prev) => [newProposal, ...prev]);
    setLedger((prev) =>
      pushAudit(prev, {
        memberId: user.id,
        type: "loan-disbursed",
        description: `Proposed ${title} · ${months} installments · ${monthlyRate}%/mo flat`,
        amount: 0,
      }),
    );
    setTab("voting");
    toast.success("Loan request posted with repayment plan", {
      description: `${fmtKsh(plan.installmentAmount)} × ${months} mo · total ${fmtKsh(plan.totalRepay)} (incl. ${fmtKsh(plan.totalInterest)} interest)`,
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

  if (!chama) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-center text-slate-100">
        <h1 className="text-xl font-bold text-white">No chama linked to this account yet</h1>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          If you just confirmed your email, sign out and sign in again once. Your chama is created on first login after confirmation.
          Otherwise create a chama from the registration page.
        </p>
        <button
          type="button"
          onClick={() => logout()}
          className="mt-6 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white"
        >
          Sign out
        </button>
      </div>
    );
  }
  if (displayMembers.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
        Loading members…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar
        chamas={displayChamas}
        activeChamaId={activeChamaId}
        unreadNotifications={unreadNotifications}
        onSwitchChama={(id) => {
          setActiveChamaId(id);
          setTab("overview");
        }}
        onOpenNotifications={() => setNotifOpen((v) => !v)}
        onResetPassword={resetPassword}
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
                members={displayMembers}
                contributions={contributions.filter((contribution) => contribution.chamaId === activeChamaId)}
                proposals={proposals}
                kits={kits}
                currentMemberId={currentMemberId}
                onContribute={() => setContribOpen(true)}
                onProposeLoan={handleProposeLoan}
              />
            )}
            {tab === "voting" && (
              <GovernanceVoting
                chamaId={activeChamaId}
                members={displayMembers}
                proposals={proposals}
                currentMemberId={currentMemberId}
                onCastVote={handleCastVote}
              />
            )}
            {tab === "loans" && (
              <LoansAndLedger
                chamaId={activeChamaId}
                chama={chama}
                members={displayMembers}
                proposals={proposals}
                ledger={chamaLedger}
                onRepay={handleRepay}
                onReschedule={handleReschedule}
                onSaveLoanRates={async (next) => {
                  if (!activeChamaId || !chama) return;
                  const constitution = {
                    ...chama.constitution,
                    loanInterestMonthlyPercent: next.defaultMonthlyPercent,
                    loanInterestOptions: next.options,
                  };
                  const { error } = await supabase
                    .from("chamas")
                    .update({ constitution })
                    .eq("id", activeChamaId);
                  if (error) {
                    toast.error(error.message);
                    return;
                  }
                  toast.success("Loan interest rates saved for this chama");
                  // refresh memberships so constitution updates in UI
                  window.location.reload();
                }}
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
                    const requester = displayMembers.find((member) => member.id === p.requesterId);
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
                          {requester?.name ?? "Member"} | {fmtKsh(p.amount)}
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