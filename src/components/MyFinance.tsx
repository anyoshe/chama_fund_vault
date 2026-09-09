import { useMemo, useState } from "react";
import {
  ChartLineUp,
  Coins,
  HandCoins,
  PiggyBank,
  Receipt,
  Calculator,
  TrendUp,
  WarningCircle,
  Wallet,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import type {
  AuditEvent,
  Chama,
  ChamaKit,
  Contribution,
  Member,
  Proposal,
} from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseYmd(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** e.g. 8 September 2026 */
function fmtLongDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? parseYmd(isoOrDate) : isoOrDate;
  if (!d) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** e.g. September 2026 */
function fmtMonthYear(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Contribution cycle: calendar month ending on due day.
 * dueDay: 1–28 (default 1). Cycle label uses real month/year.
 */
function contributionCycle(dueDay = 1, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = Math.min(Math.max(1, dueDay), 28);
  const due = new Date(y, m, day, 12, 0, 0);
  // If today is past due day, the open cycle is still this month until next month starts;
  // "next due" becomes next month's due day once overdue for display of upcoming.
  const nextDue =
    now.getDate() > day
      ? new Date(y, m + 1, day, 12, 0, 0)
      : due;
  const cycleStart = new Date(nextDue.getFullYear(), nextDue.getMonth(), 1, 12, 0, 0);
  const cycleEnd = nextDue;
  return {
    cycleStart,
    cycleEnd,
    dueDate: nextDue,
    monthLabel: fmtMonthYear(nextDue),
    dueLabel: fmtLongDate(nextDue),
    startLabel: fmtLongDate(cycleStart),
    isOverdue: now > nextDue,
    daysUntilDue: Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  };
}

function isoMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}


type MemberBalance = { user_id: string; kit_code: string; balance: number };

interface MyFinanceProps {
  chama: Chama;
  me: Member | undefined;
  members: Member[];
  contributions: Contribution[];
  proposals: Proposal[];
  kits: ChamaKit[];
  memberBalances: MemberBalance[];
  ledger: AuditEvent[];
  onContribute: () => void;
  onProposeLoan: () => void;
  canRequestLoan?: boolean;
  availableLoanLimit?: number;
  onPartialRepay?: (
    proposalId: string,
    amount: number,
    method: string,
  ) => void | Promise<void>;
}

function Card({
  title,
  value,
  sub,
  icon,
  accent = "emerald",
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "emerald" | "amber" | "violet" | "sky" | "rose";
}) {
  const tones: Record<string, string> = {
    emerald: "text-emerald-300 border-emerald-500/25 bg-emerald-500/5",
    amber: "text-amber-300 border-amber-500/25 bg-amber-500/5",
    violet: "text-violet-300 border-violet-500/25 bg-violet-500/5",
    sky: "text-sky-300 border-sky-500/25 bg-sky-500/5",
    rose: "text-rose-300 border-rose-500/25 bg-rose-500/5",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[accent]}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {title}
      </div>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

export default function MyFinance({
  chama,
  me,
  members,
  contributions,
  proposals,
  kits,
  memberBalances,
  ledger,
  onContribute,
  onProposeLoan,
  canRequestLoan = true,
  availableLoanLimit,
  onPartialRepay,
}: MyFinanceProps) {
  const [repayOpen, setRepayOpen] = useState(false);
  const [repayAmount, setRepayAmount] = useState("");
  const [repayMethod, setRepayMethod] = useState("M-Pesa STK Push");
  const [repayBusy, setRepayBusy] = useState(false);
  const myId = me?.id ?? "";

  const myContributions = useMemo(
    () =>
      contributions
        .filter((c) => c.memberId === myId && c.status === "completed")
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [contributions, myId],
  );

  const totalContributed = myContributions.reduce((s, c) => s + c.amount, 0);

  const byKit = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of myContributions) {
      const k = c.destination || "other";
      map.set(k, (map.get(k) || 0) + c.amount);
    }
    for (const b of memberBalances.filter((x) => x.user_id === myId)) {
      // Prefer live balance as source of truth for kit holding
      map.set(b.kit_code, Number(b.balance) || 0);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [myContributions, memberBalances, myId]);

  const myBalancesTotal = memberBalances
    .filter((b) => b.user_id === myId)
    .reduce((s, b) => s + (Number(b.balance) || 0), 0);

  const shareCodes = new Set(["table-banking", "share-capital", "general-savings"]);
  const myShares = memberBalances
    .filter((b) => b.user_id === myId && shareCodes.has(b.kit_code))
    .reduce((s, b) => s + (Number(b.balance) || 0), 0);
  const maxMultiple = chama.constitution?.maxLoanMultiple ?? 3;
  const rawLimit = myShares * maxMultiple;
  const loanLimit =
    availableLoanLimit != null ? availableLoanLimit : rawLimit;

  const liquidityCodes = new Set([
    "table-banking",
    "share-capital",
    "general-savings",
    "member-loans",
  ]);
  const loaningPool = kits
    .filter((k) => liquidityCodes.has(k.kit_code))
    .reduce((s, k) => s + (Number(k.balance) || 0), 0);

  const myLoans = proposals.filter(
    (p) =>
      p.chamaId === chama.id &&
      p.type === "loan" &&
      p.requesterId === myId &&
      (p.status === "disbursed" || p.status === "approved" || p.status === "active"),
  );

  const outstandingLoan = myLoans
    .filter((p) => p.status === "disbursed")
    .reduce((sum, p) => {
      const schedule = p.repayment?.schedule ?? [];
      const unpaid = schedule.filter((x) => !x.paid).reduce((s, x) => s + x.amount, 0);
      if (schedule.length) return sum + unpaid;
      return sum + p.amount;
    }, 0);

  const monthlyTarget =
    me?.monthlyContribution || chama.constitution?.minMonthlyContribution || 0;

  // Real cycle from constitution payout hint or 1st of month
  const dueDayMatch = String(chama.constitution?.payoutCycle || "1").match(/(\d{1,2})/);
  const dueDay = dueDayMatch ? Math.min(28, Math.max(1, Number(dueDayMatch[1]))) : 1;
  const cycle = contributionCycle(dueDay);
  const monthKey = isoMonthKey(cycle.dueDate);
  const paidThisCycle = myContributions
    .filter((c) => (c.date || "").startsWith(monthKey))
    .reduce((s, c) => s + c.amount, 0);
  const shortfall = Math.max(0, monthlyTarget - paidThisCycle);
  const fineRate = chama.constitution?.lateFineRate ?? 0;
  const estimatedFine = shortfall > 0 ? Math.round(shortfall * (fineRate / 100)) : 0;

  const nextLoanDues = myLoans
    .filter((p) => p.status === "disbursed" && p.repayment?.schedule?.length)
    .map((p) => {
      const next = p.repayment!.schedule.find((x) => !x.paid);
      return next
        ? {
            title: p.title,
            dueDate: next.dueDate,
            amount: next.amount,
            label: fmtLongDate(next.dueDate),
          }
        : null;
    })
    .filter(Boolean) as { title: string; dueDate: string; amount: number; label: string }[];

  const activeDisbursed = myLoans.filter((p) => p.status === "disbursed");
  const primaryLoan = activeDisbursed[0];
  const primaryOutstanding = primaryLoan
    ? (() => {
        const schedule = primaryLoan.repayment?.schedule ?? [];
        if (schedule.length) {
          return schedule.filter((x) => !x.paid).reduce((s, x) => s + x.amount, 0);
        }
        return primaryLoan.amount;
      })()
    : 0;


  const myPenalties = ledger.filter(
    (e) =>
      e.chamaId === chama.id &&
      e.memberId === myId &&
      (e.type === "penalty" || e.description.toLowerCase().includes("fine")),
  );
  const penaltiesTotal = myPenalties.reduce((s, e) => s + (e.amount || 0), 0);

  const myRepayments = ledger.filter(
    (e) =>
      e.chamaId === chama.id &&
      e.memberId === myId &&
      (e.type === "repayment" || e.type === "loan-settled"),
  );

  const groupPool = kits.reduce((s, k) => s + (Number(k.balance) || 0), 0);
  const myShareOfGroup =
    groupPool > 0 ? Math.round((myBalancesTotal / groupPool) * 1000) / 10 : 0;

  const kitLabel = (code: string) =>
    kits.find((k) => k.kit_code === code)?.label ||
    code.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  if (!me) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
        Sign in as a chama member to see your personal finance summary.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-400/90">
          My finance
        </p>
        <h2 className="mt-1 text-xl font-bold text-white">{me.name}</h2>
        <p className="mt-1 text-xs text-slate-400">
          Personal contributions, balances, loans, and fines for{" "}
          <span className="font-semibold text-slate-300">{chama.name}</span>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onContribute}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25"
          >
            <PiggyBank size={16} /> Contribute
          </button>
          <button
            type="button"
            onClick={() => {
              if (canRequestLoan) onProposeLoan();
            }}
            disabled={!canRequestLoan}
            title={
              !canRequestLoan
                ? "Settle your open loan fully before borrowing again"
                : "Request loan"
            }
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold ${
              canRequestLoan
                ? "border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                : "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-500"
            }`}
          >
            <HandCoins size={16} />{" "}
            {canRequestLoan ? "Request loan" : "Loan locked — settle first"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!primaryLoan) return;
              setRepayAmount(String(Math.round(primaryOutstanding * 100) / 100));
              setRepayOpen((v) => !v);
            }}
            disabled={!primaryLoan || !onPartialRepay}
            title={
              !primaryLoan
                ? "No disbursed loan to repay"
                : "Repay your outstanding loan"
            }
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold ${
              primaryLoan && onPartialRepay
                ? "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
                : "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-500"
            }`}
          >
            <Receipt size={16} />{" "}
            {primaryLoan ? "Repay loan" : "No loan to repay"}
          </button>
        </div>

        {repayOpen && primaryLoan && onPartialRepay && (
          <div className="mt-4 rounded-xl border border-amber-500/25 bg-slate-950/60 p-4">
            <p className="text-xs font-bold text-white">
              Repay · {primaryLoan.title}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Outstanding balance {fmtKsh(primaryOutstanding)}. Edit amount if paying part of it.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-[11px] font-semibold text-slate-400">
                Amount (KES)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-amber-400/50"
                />
              </label>
              <label className="flex-1 text-[11px] font-semibold text-slate-400">
                Payment method
                <select
                  value={repayMethod}
                  onChange={(e) => setRepayMethod(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50"
                >
                  <option>M-Pesa STK Push</option>
                  <option>M-Pesa Paybill</option>
                  <option>Bank transfer</option>
                  <option>Cash to treasurer (recorded)</option>
                </select>
              </label>
              <button
                type="button"
                disabled={repayBusy}
                onClick={async () => {
                  const amt = Math.round(Number(repayAmount) * 100) / 100;
                  if (!amt || amt <= 0) return;
                  setRepayBusy(true);
                  try {
                    await onPartialRepay(primaryLoan.id, amt, repayMethod);
                    setRepayOpen(false);
                  } finally {
                    setRepayBusy(false);
                  }
                }}
                className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {repayBusy ? "Posting…" : "Confirm repayment"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          title="My kit balances"
          value={fmtKsh(myBalancesTotal || totalContributed)}
          sub="All pots · deposits + interest"
          icon={<Wallet size={14} />}
          accent="emerald"
        />
        <Card
          title={`Paid · ${cycle.monthLabel}`}
          value={fmtKsh(paidThisCycle)}
          sub={
            monthlyTarget
              ? `Due ${cycle.dueLabel} · target ${fmtKsh(monthlyTarget)}${
                  shortfall > 0
                    ? cycle.isOverdue
                      ? ` · overdue by ${Math.abs(cycle.daysUntilDue)}d`
                      : ` · short ${fmtKsh(shortfall)} · ${cycle.daysUntilDue}d left`
                    : " · on track"
                }`
              : `Due ${cycle.dueLabel}`
          }
          icon={<Coins size={14} />}
          accent={shortfall > 0 ? "amber" : "sky"}
        />
        <Card
          title="Loan limit"
          value={fmtKsh(loanLimit)}
          sub={
            canRequestLoan
              ? `${maxMultiple}× shares ${fmtKsh(myShares)} · pool ${fmtKsh(loaningPool)}`
              : "Locked until current loan is fully repaid"
          }
          icon={<Calculator size={14} />}
          accent="violet"
        />
        <Card
          title="Outstanding loans"
          value={fmtKsh(outstandingLoan)}
          sub={
            myLoans.length
              ? `${myLoans.filter((p) => p.status === "disbursed").length} active facility`
              : "No open facilities"
          }
          icon={<HandCoins size={14} />}
          accent="rose"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Balances by kit */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <ChartLineUp size={18} className="text-emerald-400" /> Holdings by kit
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Live balances (contributions plus any interest credited to you)
          </p>
          <div className="mt-3 space-y-2">
            {byKit.length === 0 ? (
              <p className="text-xs text-slate-500">No balances yet — make a contribution.</p>
            ) : (
              byKit.map(([code, amount]) => (
                <div
                  key={code}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-slate-300">{kitLabel(code)}</span>
                  <span className="font-mono text-xs font-bold text-emerald-300">
                    {fmtKsh(amount)}
                  </span>
                </div>
              ))
            )}
          </div>
          {groupPool > 0 && (
            <p className="mt-3 text-[11px] text-slate-500">
              Your share of group pots:{" "}
              <span className="font-semibold text-slate-300">{myShareOfGroup}%</span> of{" "}
              {fmtKsh(groupPool)}
            </p>
          )}
        </motion.div>

        {/* Cycle + fines */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <WarningCircle size={18} className="text-amber-400" />{" "}
            {cycle.monthLabel} cycle & fines
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Contribution window {cycle.startLabel} → due{" "}
            <span className="font-semibold text-slate-300">{cycle.dueLabel}</span>
            {" · "}
            late fine {fineRate}% of missed amount
          </p>
          <div className="mt-3 space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Paid in {cycle.monthLabel}</span>
              <span className="font-mono text-slate-200">{fmtKsh(paidThisCycle)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Target for this cycle</span>
              <span className="font-mono text-slate-200">{fmtKsh(monthlyTarget)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full ${
                  shortfall > 0 ? "bg-amber-400" : "bg-emerald-500"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    monthlyTarget > 0 ? (paidThisCycle / monthlyTarget) * 100 : 0,
                  )}%`,
                }}
              />
            </div>
            {shortfall > 0 ? (
              <p className="text-xs text-amber-300/90">
                Shortfall {fmtKsh(shortfall)}
                {estimatedFine > 0
                  ? ` · estimated fine if cycle closes unpaid: ${fmtKsh(estimatedFine)}`
                  : ""}
              </p>
            ) : (
              <p className="text-xs text-emerald-400/90">
                On track for {cycle.monthLabel}
                {cycle.daysUntilDue >= 0 ? ` · due ${cycle.dueLabel}` : ""}.
              </p>
            )}
            {nextLoanDues.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-2">
                <p className="text-[11px] font-semibold text-slate-400">Loan installments due</p>
                {nextLoanDues.map((d) => (
                  <div
                    key={d.title + d.dueDate}
                    className="mt-1 flex justify-between gap-2 text-xs text-slate-400"
                  >
                    <span className="truncate text-slate-300">{d.title}</span>
                    <span className="shrink-0 font-mono text-amber-300">
                      {fmtKsh(d.amount)} · {d.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
              <span>Recorded penalties</span>
              <span className="font-mono text-rose-300">{fmtKsh(penaltiesTotal)}</span>
            </div>
            {myPenalties.length > 0 && (
              <div className="max-h-28 space-y-1 overflow-y-auto">
                {myPenalties.slice(0, 5).map((e) => (
                  <p key={e.id} className="text-[10px] text-slate-500">
                    {e.description} · {fmtKsh(e.amount)}
                  </p>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Contribution history */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-white">
          <Receipt size={18} className="text-sky-400" /> My contribution history
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="pb-2 font-semibold">Date</th>
                <th className="pb-2 font-semibold">Kit</th>
                <th className="pb-2 font-semibold">Method</th>
                <th className="pb-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {myContributions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-500">
                    No contributions recorded yet.
                  </td>
                </tr>
              ) : (
                myContributions.slice(0, 25).map((c) => (
                  <tr key={c.id} className="border-b border-slate-800/80">
                    <td className="py-2 text-slate-400">
                      {c.date ? fmtLongDate(c.date) : "—"}
                    </td>
                    <td className="py-2 text-slate-300">{kitLabel(c.destination)}</td>
                    <td className="py-2 text-slate-500">{c.method || "—"}</td>
                    <td className="py-2 text-right font-mono font-semibold text-emerald-300">
                      {fmtKsh(c.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Lifetime deposited (contribution rows): {fmtKsh(totalContributed)}
        </p>
      </div>

      {/* Loans + repayments snapshot */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <HandCoins size={18} className="text-violet-400" /> My loans
          </p>
          {myLoans.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No open or pending loan applications.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {myLoans.map((p) => {
                const unpaid =
                  p.repayment?.schedule
                    ?.filter((x) => !x.paid)
                    .reduce((s, x) => s + x.amount, 0) ?? p.amount;
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-200">{p.title}</p>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">
                        {p.status}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      Principal {fmtKsh(p.amount)}
                      {p.status === "disbursed" ? ` · remaining ${fmtKsh(unpaid)}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <TrendUp size={18} className="text-teal-400" /> Recent repayments
          </p>
          {myRepayments.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No repayment events on your account yet.</p>
          ) : (
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {myRepayments.slice(0, 12).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                >
                  <p className="text-[11px] text-slate-400 line-clamp-2">{e.description}</p>
                  <span className="shrink-0 font-mono text-xs font-bold text-teal-300">
                    {fmtKsh(e.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-[11px] text-slate-600">
        Transparent personal ledger · {members.length} members in {chama.name} · zero-cash rails
      </p>
    </div>
  );
}
