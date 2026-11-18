import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  Clock,
  CurrencyCircleDollar,
  HandCoins,
  ListBullets,
  Wallet,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fmtKsh } from "@/data/mockChamaData";
import type {
  Contribution,
  ContributionObligation,
  Member,
  Proposal,
} from "@/types/chama";

type Panel = "home" | "owe" | "loan" | "history";

interface SimpleMemberHomeProps {
  chamaId: string;
  chamaName: string;
  me?: Member;
  contributions: Contribution[];
  proposals: Proposal[];
  onOpenContribute: () => void;
  onProposeLoan: () => void;
  onPartialRepay: (
    proposalId: string,
    amount: number,
    method: string,
  ) => Promise<void>;
  canRequestLoan: boolean;
  availableLoanLimit: number;
  pendingVotes: number;
  onGoVote: () => void;
  isOfficial: boolean;
  onOpenFullApp?: () => void;
}

function outstandingOf(p: Proposal): number {
  if (p.status === "settled") return 0;
  if (p.repayment?.schedule?.length) {
    return p.repayment.schedule
      .filter((s) => !s.paid)
      .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }
  return Number(p.amount) || 0;
}

export default function SimpleMemberHome({
  chamaId,
  chamaName,
  me,
  contributions,
  proposals,
  onOpenContribute,
  onProposeLoan,
  onPartialRepay,
  canRequestLoan,
  availableLoanLimit,
  pendingVotes,
  onGoVote,
  isOfficial,
  onOpenFullApp,
}: SimpleMemberHomeProps) {
  const [panel, setPanel] = useState<Panel>("home");
  const [obligations, setObligations] = useState<ContributionObligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [repayingId, setRepayingId] = useState<string | null>(null);

  const myId = me?.id;

  const loadObligations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("list_my_obligations", {
        p_chama_id: chamaId,
      });
      if (error) throw error;
      setObligations(
        (Array.isArray(data) ? data : []) as ContributionObligation[],
      );
    } catch {
      setObligations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadObligations();
  }, [chamaId]);

  const totalOwed = useMemo(
    () => obligations.reduce((s, o) => s + (Number(o.outstanding) || 0), 0),
    [obligations],
  );

  const myOpenLoans = useMemo(() => {
    if (!myId) return [];
    return proposals.filter(
      (p) =>
        p.chamaId === chamaId &&
        p.requesterId === myId &&
        (p.status === "disbursed" || p.status === "approved") &&
        outstandingOf(p) > 0,
    );
  }, [proposals, myId, chamaId]);

  const loanBalance = useMemo(
    () => myOpenLoans.reduce((s, p) => s + outstandingOf(p), 0),
    [myOpenLoans],
  );

  const myHistory = useMemo(() => {
    if (!myId) return [];
    return contributions
      .filter((c) => c.memberId === myId)
      .slice()
      .sort((a, b) => (b.date > a.date ? 1 : -1))
      .slice(0, 30);
  }, [contributions, myId]);

  const payObligation = async (o: ContributionObligation) => {
    const amt = Number(o.outstanding) || 0;
    if (amt <= 0) return;
    setPayingId(o.id);
    try {
      const ref = `SM${Date.now().toString().slice(-8)}`;
      const { error } = await supabase.rpc("pay_contribution_obligation", {
        p_obligation_id: o.id,
        p_amount: amt,
        p_method: "Other",
        p_reference: ref,
        p_phone: null,
        p_payment_details: "Simple home pay",
      });
      if (error) throw error;
      toast.success(`Paid ${fmtKsh(amt)}`);
      await loadObligations();
      setPanel("home");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPayingId(null);
    }
  };

  const payLoan = async (p: Proposal) => {
    const amt = outstandingOf(p);
    if (amt <= 0) return;
    const raw = window.prompt(
      `Amount to pay (full balance ${fmtKsh(amt)})`,
      String(amt),
    );
    if (raw == null) return;
    const n = Number(raw);
    if (!n || n <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setRepayingId(p.id);
    try {
      await onPartialRepay(p.id, Math.min(n, amt), "Other");
      toast.success(`Loan payment ${fmtKsh(Math.min(n, amt))}`);
      setPanel("home");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Repay failed");
    } finally {
      setRepayingId(null);
    }
  };

  const firstName = (me?.name || "Member").split(" ")[0];

  if (panel === "owe") {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <button
          type="button"
          onClick={() => setPanel("home")}
          className="text-sm font-semibold text-slate-400 hover:text-white"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-white">What I owe</h2>
        <p className="text-sm text-slate-400">
          Amounts due for this chama. Tap <strong className="text-white">Pay</strong>{" "}
          when you are ready.
        </p>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : obligations.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <CheckCircle size={36} className="mx-auto text-emerald-400" />
            <p className="mt-3 text-lg font-bold text-white">Nothing due</p>
            <p className="mt-1 text-sm text-slate-400">
              You have no open contribution balances.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {obligations.map((o) => (
              <div
                key={o.id}
                className="rounded-2xl border border-amber-500/25 bg-slate-900 p-4"
              >
                <p className="text-lg font-bold text-white">{o.planName}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {o.periodKey}
                  {o.dueDate ? ` · due ${String(o.dueDate).slice(0, 10)}` : ""}
                </p>
                <p className="mt-3 font-mono text-2xl font-bold text-amber-300">
                  {fmtKsh(Number(o.outstanding) || 0)}
                </p>
                <button
                  type="button"
                  disabled={payingId === o.id}
                  onClick={() => void payObligation(o)}
                  className="mt-4 w-full rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  {payingId === o.id ? "Paying…" : "Pay"}
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onOpenContribute}
          className="w-full rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-200"
        >
          Pay something else (choose pot)
        </button>
      </div>
    );
  }

  if (panel === "loan") {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <button
          type="button"
          onClick={() => setPanel("home")}
          className="text-sm font-semibold text-slate-400 hover:text-white"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-white">My loan</h2>
        {myOpenLoans.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center">
            <p className="text-lg font-bold text-white">No open loan</p>
            <p className="mt-2 text-sm text-slate-400">
              You can borrow up to{" "}
              <span className="font-semibold text-emerald-300">
                {fmtKsh(availableLoanLimit)}
              </span>
              .
            </p>
            {canRequestLoan && availableLoanLimit > 0 && (
              <button
                type="button"
                onClick={onProposeLoan}
                className="mt-5 w-full rounded-xl bg-violet-500 py-3.5 text-base font-bold text-white hover:bg-violet-400"
              >
                Request loan
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {myOpenLoans.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-violet-500/25 bg-slate-900 p-4"
              >
                <p className="text-sm text-slate-400">{p.title || "Loan"}</p>
                <p className="mt-2 font-mono text-2xl font-bold text-violet-200">
                  {fmtKsh(outstandingOf(p))}
                </p>
                <p className="mt-1 text-xs text-slate-500">Balance still to pay</p>
                <button
                  type="button"
                  disabled={repayingId === p.id}
                  onClick={() => void payLoan(p)}
                  className="mt-4 w-full rounded-xl bg-emerald-500 py-3.5 text-base font-bold text-white disabled:opacity-50"
                >
                  {repayingId === p.id ? "Paying…" : "Repay loan"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (panel === "history") {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <button
          type="button"
          onClick={() => setPanel("home")}
          className="text-sm font-semibold text-slate-400 hover:text-white"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-white">History</h2>
        <p className="text-sm text-slate-400">Your recent payments</p>
        {myHistory.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
            No payments yet
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {myHistory.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-white">
                    {fmtKsh(c.amount)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {String(c.date).slice(0, 10)}
                    {c.destination ? ` · ${c.destination}` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                  {c.status === "completed" ? "Paid" : c.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // HOME
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-emerald-950/40 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-400/90">
          {chamaName}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">
          Habari, {firstName}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Your chama book on the phone. Pay dues, check loans, see history.
        </p>
      </div>

      {pendingVotes > 0 && (
        <button
          type="button"
          onClick={onGoVote}
          className="flex w-full items-center justify-between rounded-2xl border border-amber-500/40 bg-amber-500/15 px-4 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <Clock size={28} className="text-amber-300" />
            <div>
              <p className="font-bold text-white">Votes waiting</p>
              <p className="text-xs text-amber-200/80">
                {pendingVotes} item{pendingVotes === 1 ? "" : "s"} need your vote
              </p>
            </div>
          </div>
          <span className="text-sm font-bold text-amber-200">Vote →</span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPanel("owe")}
          className="flex min-h-[7.5rem] flex-col items-start justify-between rounded-2xl border border-amber-500/30 bg-slate-900 p-5 text-left transition hover:border-amber-400/50 hover:bg-slate-900/80"
        >
          <Wallet size={32} className="text-amber-400" />
          <div>
            <p className="text-lg font-bold text-white">What I owe</p>
            <p className="mt-1 font-mono text-sm text-amber-200">
              {loading ? "…" : totalOwed > 0 ? fmtKsh(totalOwed) : "Ksh 0"}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (totalOwed > 0) setPanel("owe");
            else onOpenContribute();
          }}
          className="flex min-h-[7.5rem] flex-col items-start justify-between rounded-2xl border border-emerald-500/40 bg-emerald-500/15 p-5 text-left transition hover:bg-emerald-500/25"
        >
          <CurrencyCircleDollar size={32} className="text-emerald-400" />
          <div>
            <p className="text-lg font-bold text-white">Pay</p>
            <p className="mt-1 text-sm text-emerald-200/90">
              {totalOwed > 0 ? "Pay what you owe" : "Make a contribution"}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel("loan")}
          className="flex min-h-[7.5rem] flex-col items-start justify-between rounded-2xl border border-violet-500/30 bg-slate-900 p-5 text-left transition hover:border-violet-400/50"
        >
          <HandCoins size={32} className="text-violet-400" />
          <div>
            <p className="text-lg font-bold text-white">My loan</p>
            <p className="mt-1 font-mono text-sm text-violet-200">
              {loanBalance > 0 ? fmtKsh(loanBalance) : "No open loan"}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel("history")}
          className="flex min-h-[7.5rem] flex-col items-start justify-between rounded-2xl border border-sky-500/30 bg-slate-900 p-5 text-left transition hover:border-sky-400/50"
        >
          <ListBullets size={32} className="text-sky-400" />
          <div>
            <p className="text-lg font-bold text-white">History</p>
            <p className="mt-1 text-sm text-sky-200/80">
              {myHistory.length} recent payment
              {myHistory.length === 1 ? "" : "s"}
            </p>
          </div>
        </button>
      </div>

      {isOfficial && onOpenFullApp && (
        <button
          type="button"
          onClick={onOpenFullApp}
          className="w-full rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800"
        >
          Open full chama controls (officials)
        </button>
      )}
    </div>
  );
}
