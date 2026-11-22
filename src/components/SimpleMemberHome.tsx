import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  CurrencyCircleDollar,
  HandCoins,
  ListBullets,
  PiggyBank,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { potOptionsForChama } from "@/lib/kitVisibility";
import { fmtKsh } from "@/data/mockChamaData";
import type {
  Contribution,
  ContributionObligation,
  Member,
  Proposal,
} from "@/types/chama";

/** Plain names members understand */
const POT_LABEL: Record<string, string> = {
  "table-banking": "Table banking",
  "share-capital": "Shares (share capital)",
  "general-savings": "General savings",
  "member-loans": "Member loans fund",
  "merry-go-round": "Merry-go-round",
  welfare: "Welfare / emergency",
  "welfare-pot": "Welfare / emergency",
  contingency: "Contingency / special",
  "registration-fees": "Registration fee",
  "group-reserve": "Group reserve",
  "investment-pool": "Investment",
  "education-fund": "Education fund",
};

function potName(code?: string) {
  if (!code) return "Savings";
  return POT_LABEL[code] || code.replace(/-/g, " ");
}

type Panel =
  | "home"
  | "owe"
  | "pay-pot"
  | "pots"
  | "loan"
  | "history"
  | "help";

interface SimpleMemberHomeProps {
  chamaId: string;
  chamaName: string;
  enabledKitCodes?: string[] | null;
  me?: Member;
  contributions: Contribution[];
  proposals: Proposal[];
  memberBalances: { user_id: string; kit_code: string; balance: number }[];
  onOpenContribute: () => void;
  onOpenContributeToKit: (kit: string) => void;
  /** Open payment modal for an obligation (amount + note) */
  onPayOwe?: (amount: number, note: string, destination?: string) => void;
  onRequestLoanRepay?: (proposalId: string, amount: number) => void;
  onRequestObligationPay?: (obligationId: string, amount: number, note: string, destinationKit?: string) => void;
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

function totalRepayOf(p: Proposal): number {
  if (p.repayment?.schedule?.length) {
    return p.repayment.schedule.reduce(
      (sum, s) => sum + (Number(s.amount) || 0),
      0,
    );
  }
  return Number(p.amount) || 0;
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white"
    >
      <ArrowLeft size={16} /> Back to home
    </button>
  );
}

export default function SimpleMemberHome({
  chamaId,
  chamaName,
  enabledKitCodes,
  me,
  contributions,
  proposals,
  memberBalances,
  onOpenContribute,
  onOpenContributeToKit,
  onPayOwe,
  onRequestLoanRepay,
  onRequestObligationPay,
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

  const myPots = useMemo(() => {
    if (!myId) return [];
    const map = new Map<string, number>();
    for (const b of memberBalances) {
      if (b.user_id !== myId) continue;
      map.set(b.kit_code, (map.get(b.kit_code) || 0) + (Number(b.balance) || 0));
    }
    if (map.size === 0) {
      for (const c of contributions) {
        if (c.memberId !== myId || !c.destination) continue;
        map.set(
          c.destination,
          (map.get(c.destination) || 0) + (Number(c.amount) || 0),
        );
      }
    }
    return Array.from(map.entries())
      .map(([code, balance]) => ({ code, balance, label: potName(code) }))
      .filter((x) => x.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [memberBalances, contributions, myId]);

  const myOpenLoans = useMemo(() => {
    if (!myId) return [];
    return proposals.filter(
      (p) =>
        p.chamaId === chamaId &&
        p.requesterId === myId &&
        (p.status === "disbursed" ||
          p.status === "approved" ||
          p.status === "active") &&
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
      .slice(0, 40);
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
        p_payment_details: "Member home pay",
      });
      if (error) throw error;
      toast.success(`Paid ${fmtKsh(amt)} — thank you`);
      await loadObligations();
      setPanel("home");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed. Try again.");
    } finally {
      setPayingId(null);
    }
  };

  const payLoan = async (p: Proposal) => {
    const amt = outstandingOf(p);
    if (amt <= 0) return;
    const raw = window.prompt(
      `How much do you want to pay now?\n(Full balance: ${fmtKsh(amt)})`,
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
      toast.success(`Loan payment ${fmtKsh(Math.min(n, amt))} recorded`);
      setPanel("home");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Repay failed");
    } finally {
      setRepayingId(null);
    }
  };

  const firstName = (me?.name || "Member").split(" ")[0];

  const PAY_POTS_ALL = [
    { code: "table-banking", label: "Table banking", hint: "Monthly table money" },
    { code: "share-capital", label: "Shares", hint: "Share capital" },
    { code: "merry-go-round", label: "Merry-go-round", hint: "ROSCA turn money" },
    { code: "general-savings", label: "General savings", hint: "Flexible savings" },
    { code: "welfare", label: "Welfare", hint: "Emergency / bereavement" },
    { code: "registration-fees", label: "Registration", hint: "Joining fee" },
    { code: "member-loans", label: "Loan fund", hint: "Money for lending" },
  ];
  const PAY_POTS =
    enabledKitCodes && enabledKitCodes.length > 0
      ? PAY_POTS_ALL.filter((p) => enabledKitCodes.includes(p.code))
      : PAY_POTS_ALL;

  if (panel === "owe") {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8">
        <Back onClick={() => setPanel("home")} />
        <h2 className="text-2xl font-bold text-white">What I need to pay</h2>
        <p className="text-sm text-slate-400">
          Amounts the chama expects from you. Tap{" "}
          <strong className="text-white">Pay now</strong>.
        </p>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : obligations.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <CheckCircle size={40} className="mx-auto text-emerald-400" weight="fill" />
            <p className="mt-3 text-lg font-bold text-white">You are up to date</p>
            <p className="mt-1 text-sm text-slate-400">
              No open dues. You can still pay into a pot anytime.
            </p>
            <button
              type="button"
              onClick={() => setPanel("pay-pot")}
              className="mt-4 w-full rounded-xl bg-emerald-500 py-3 font-bold text-white"
            >
              Pay into a pot
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {obligations.map((o) => (
              <div
                key={o.id}
                className="rounded-2xl border border-amber-500/30 bg-slate-900 p-4"
              >
                <p className="text-lg font-bold text-white">{o.planName}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {potName(o.destinationKit)}
                  {o.dueDate ? ` · pay by ${String(o.dueDate).slice(0, 10)}` : ""}
                </p>
                <p className="mt-3 font-mono text-3xl font-bold text-amber-300">
                  {fmtKsh(Number(o.outstanding) || 0)}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const amt = Number(o.outstanding) || 0;
                    const note = `${o.planName} → ${potName(o.destinationKit)}`;
                    if (onRequestObligationPay) {
                      onRequestObligationPay(
                        o.id,
                        amt,
                        note,
                        o.destinationKit,
                      );
                      return;
                    }
                    if (onPayOwe) {
                      onPayOwe(amt, note, o.destinationKit);
                      return;
                    }
                    onOpenContribute();
                  }}
                  className="mt-4 w-full rounded-xl bg-emerald-500 py-4 text-base font-bold text-white hover:bg-emerald-400"
                >
                  Pay now
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (panel === "pay-pot") {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8">
        <Back onClick={() => setPanel("home")} />
        <h2 className="text-2xl font-bold text-white">Where should this money go?</h2>
        <p className="text-sm text-slate-400">
          Choose one pot, then enter amount and confirm — like sending M-Pesa.
        </p>
        <div className="space-y-2">
          {PAY_POTS.map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => onOpenContributeToKit(p.code)}
              className="flex w-full items-center justify-between rounded-2xl border border-slate-700 bg-slate-900 px-4 py-4 text-left hover:border-emerald-500/50"
            >
              <div>
                <p className="text-base font-bold text-white">{p.label}</p>
                <p className="text-xs text-slate-500">{p.hint}</p>
              </div>
              <span className="text-sm font-bold text-emerald-400">Pay →</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenContribute}
          className="w-full rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-300"
        >
          Other / more options
        </button>
      </div>
    );
  }

  if (panel === "pots") {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8">
        <Back onClick={() => setPanel("home")} />
        <h2 className="text-2xl font-bold text-white">My money in each pot</h2>
        <p className="text-sm text-slate-400">What you have in each account so far.</p>
        {myPots.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
            No balances yet. Pay into a pot to see it here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            {myPots.map((p) => (
              <li key={p.code} className="flex items-center justify-between px-4 py-4">
                <span className="text-sm font-semibold text-white">{p.label}</span>
                <span className="font-mono text-base font-bold text-emerald-300">
                  {fmtKsh(p.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setPanel("pay-pot")}
          className="w-full rounded-xl bg-emerald-500 py-3.5 font-bold text-white"
        >
          Add money to a pot
        </button>
      </div>
    );
  }

  if (panel === "loan") {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8">
        <Back onClick={() => setPanel("home")} />
        <h2 className="text-2xl font-bold text-white">My loan</h2>
        <p className="text-sm text-slate-400">
          How much you still owe, and how to pay it back.
        </p>
        {myOpenLoans.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <p className="text-lg font-bold text-white">You have no open loan</p>
            <p className="mt-2 text-sm text-slate-400">
              You may request up to{" "}
              <strong className="text-emerald-300">{fmtKsh(availableLoanLimit)}</strong>{" "}
              (from your shares). The group votes before money is sent.
            </p>
            {canRequestLoan && availableLoanLimit > 0 ? (
              <button
                type="button"
                onClick={onProposeLoan}
                className="mt-5 w-full rounded-xl bg-violet-500 py-4 text-base font-bold text-white"
              >
                Request a loan
              </button>
            ) : (
              <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                {!canRequestLoan
                  ? "Finish paying your current loan before borrowing again."
                  : "Build shares (table banking / share capital) before you can borrow."}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {myOpenLoans.map((p) => {
              const out = outstandingOf(p);
              const total = totalRepayOf(p);
              const principal = Number(p.amount) || 0;
              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-violet-500/30 bg-slate-900 p-5"
                >
                  <p className="text-sm text-slate-400">
                    {p.status === "active"
                      ? "Waiting for group votes"
                      : p.status === "approved"
                        ? "Approved — waiting for treasurer to send money"
                        : "Active loan"}
                  </p>
                  <p className="mt-3 text-xs font-semibold uppercase text-slate-500">
                    Still to repay
                  </p>
                  <p className="font-mono text-3xl font-bold text-violet-200">
                    {fmtKsh(out)}
                  </p>
                  <div className="mt-3 space-y-1 text-sm text-slate-400">
                    <p className="flex justify-between">
                      <span>Borrowed</span>
                      <span className="font-mono text-slate-200">{fmtKsh(principal)}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>Total plan (with interest)</span>
                      <span className="font-mono text-slate-200">{fmtKsh(total)}</span>
                    </p>
                  </div>
                  {p.status !== "active" && out > 0 && (
                    <button
                      type="button"
                      disabled={repayingId === p.id}
                      onClick={() => void payLoan(p)}
                      className="mt-5 w-full rounded-xl bg-emerald-500 py-4 text-base font-bold text-white disabled:opacity-50"
                    >
                      {repayingId === p.id ? "Paying…" : "Pay my loan"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (panel === "history") {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8">
        <Back onClick={() => setPanel("home")} />
        <h2 className="text-2xl font-bold text-white">My statement</h2>
        <p className="text-sm text-slate-400">Every payment — date, pot, amount.</p>
        {myHistory.length === 0 ? (
          <p className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
            No payments yet
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <ul className="divide-y divide-slate-800/80">
              {myHistory.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {potName(c.destination)}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {String(c.date).slice(0, 10)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold text-emerald-300">
                      {fmtKsh(c.amount)}
                    </p>
                    <p className="text-[10px] font-bold text-emerald-500/80">PAID</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (panel === "help") {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8">
        <Back onClick={() => setPanel("home")} />
        <h2 className="text-2xl font-bold text-white">How do I use this?</h2>
        <ol className="space-y-3 text-sm">
          {[
            ["Join", "Chair adds you or sends invite link. Sign in with phone or email + password."],
            ["Pay", "Tap Pay contribution → choose pot (table banking, shares…) → amount → confirm."],
            ["See my money", "My pots shows balances. My statement lists every payment."],
            ["Borrow", "My loan → Request a loan → members vote → treasurer sends money. Then Pay my loan."],
            ["Vote", "Yellow banner means the group needs your Yes or No. Tap Vote."],
          ].map(([t, b]) => (
            <li key={t} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <strong className="text-white">{t}</strong>
              <p className="mt-1 text-slate-400">{b}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-emerald-950/50 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
          {chamaName}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-white">Habari, {firstName}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Your chama book. Pay, check pots, borrow and repay — step by step.
        </p>
      </div>

      {pendingVotes > 0 && (
        <button
          type="button"
          onClick={onGoVote}
          className="flex w-full items-center justify-between rounded-2xl border-2 border-amber-400/50 bg-amber-500/20 px-4 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <Clock size={28} className="shrink-0 text-amber-300" weight="fill" />
            <div>
              <p className="font-bold text-white">Please vote</p>
              <p className="text-xs text-amber-100/90">
                {pendingVotes} request{pendingVotes === 1 ? "" : "s"} need your Yes or No
              </p>
            </div>
          </div>
          <span className="text-sm font-bold text-amber-200">Vote →</span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => setPanel(totalOwed > 0 ? "owe" : "pay-pot")}
          className="flex items-center gap-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/15 px-5 py-5 text-left hover:bg-emerald-500/25"
        >
          <CurrencyCircleDollar size={40} className="shrink-0 text-emerald-400" weight="fill" />
          <div>
            <p className="text-lg font-bold text-white">Pay contribution</p>
            <p className="text-sm text-emerald-100/80">
              {totalOwed > 0
                ? `You owe ${fmtKsh(totalOwed)} — tap to pay`
                : "Table banking, shares, merry-go-round…"}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel("pots")}
          className="flex items-center gap-4 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4 text-left hover:border-sky-500/40"
        >
          <PiggyBank size={36} className="shrink-0 text-sky-400" />
          <div>
            <p className="text-base font-bold text-white">My pots (balances)</p>
            <p className="text-sm text-slate-400">Table banking, shares, and more</p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel("loan")}
          className="flex items-center gap-4 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4 text-left hover:border-violet-500/40"
        >
          <HandCoins size={36} className="shrink-0 text-violet-400" />
          <div>
            <p className="text-base font-bold text-white">My loan</p>
            <p className="text-sm text-slate-400">
              {loanBalance > 0
                ? `Still to repay: ${fmtKsh(loanBalance)}`
                : "Borrow or check your loan"}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setPanel("history")}
          className="flex items-center gap-4 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4 text-left"
        >
          <ListBullets size={36} className="shrink-0 text-slate-300" />
          <div>
            <p className="text-base font-bold text-white">My statement</p>
            <p className="text-sm text-slate-400">History of everything you paid</p>
          </div>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setPanel("help")}
        className="w-full text-center text-sm font-semibold text-slate-500 hover:text-slate-300"
      >
        How do I use this app?
      </button>

      {isOfficial && onOpenFullApp && (
        <button
          type="button"
          onClick={onOpenFullApp}
          className="w-full rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-400"
        >
          Officials: full chama controls
        </button>
      )}
    </div>
  );
}
