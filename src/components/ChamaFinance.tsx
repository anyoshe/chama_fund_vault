import { useEffect, useMemo, useState } from "react";
import {
  Bank,
  CaretDown,
  ChartLineUp,
  Coins,
  GearSix,
  HandCoins,
  Lock,
  Receipt,
  TrendUp,
  UsersThree,
  Wallet,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import type {
  AuditEvent,
  Chama,
  ChamaKit,
  Contribution,
  ContributionPlan,
  Member,
  Proposal,
} from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";
import { LoanRatesChairPanel } from "./LoansAndLedger";
import { SimpleFieldsModal, ChoiceModal } from "./FlowModals";
import AppModal from "./AppModal";
import { supabase } from "@/lib/supabase";
import { filterVisibleKits, potOptionsForChama, isRetiredWelfareExpenseKit } from "@/lib/kitVisibility";
import { toast } from "sonner";
import {
  buildMonthlyPotMatrix,
  downloadTextFile,
  monthlyPotMatrixToCsv,
  potLabel,
} from "@/lib/monthlyPotReport";


type MemberBalance = { user_id: string; kit_code: string; balance: number };

interface ChamaFinanceProps {
  chama: Chama;
  chamaId: string;
  members: Member[];
  contributions: Contribution[];
  proposals: Proposal[];
  kits: ChamaKit[];
  memberBalances: MemberBalance[];
  ledger: { id: string; chamaId: string; description: string; amount: number }[];
  canDisburse: boolean;
  onRepay: (proposalId: string) => void;
  onReschedule: (
    proposalId: string,
    repayment: import("../types/chama").LoanRepaymentPlan,
    meta: { mode: "early" | "extend"; settleAmount?: number },
  ) => void;
  onDisburse: (proposalId: string) => void | Promise<void>;
  onBorrow?: () => void;
  onPartialRepay?: (
    proposalId: string,
    amount: number,
    method: string,
  ) => void | Promise<void>;
  loanLimit?: number;
  shareBalance?: number;
  onSaveLoanRates?: (next: {
    defaultMonthlyPercent: number;
    options: { label: string; monthlyPercent: number }[];
    interestReservePercent?: number;
    interestSplitBasis?:
      | "share-capital"
      | "four-kits"
      | "table-banking"
      | "member-loans";
  }) => void | Promise<void>;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fmtLongDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function Kpi({
  label,
  value,
  sub,
  icon,
  accent = "emerald",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: "emerald" | "amber" | "violet" | "sky" | "rose";
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/25 bg-emerald-500/5 text-emerald-300",
    amber: "border-amber-500/25 bg-amber-500/5 text-amber-300",
    violet: "border-violet-500/25 bg-violet-500/5 text-violet-300",
    sky: "border-sky-500/25 bg-sky-500/5 text-sky-300",
    rose: "border-rose-500/25 bg-rose-500/5 text-rose-300",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[accent]}`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums text-white">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}


function CollapseSection({
  title,
  subtitle,
  open,
  onToggle,
  children,
  count,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-bold text-white">
            {title}
            {typeof count === "number" && (
              <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                {count}
              </span>
            )}
          </p>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        <CaretDown
          size={18}
          className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-slate-800 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}


function OpsReportCards({
  chama,
  chamaId,
  members,
  chamaProposals,
  paidLoans,
  awaitingDisburse,
  activeVotes,
  rejected,
  outstandingPrincipal,
  outstandingInterest,
  loaningPool,
  kits,
  interestAccrued,
  interestCollected,
  repaidPrincipal,
  totalContributions,
  completedContributions,
  reserveBalance,
  opsCard,
  setOpsCard,
  monthLabel,
  ledger,
  canDisburse,
  onDisburse,
}: {
  chama: Chama;
  chamaId: string;
  members: Member[];
  chamaProposals: Proposal[];
  paidLoans: Proposal[];
  awaitingDisburse: Proposal[];
  activeVotes: Proposal[];
  rejected: Proposal[];
  outstandingPrincipal: number;
  outstandingInterest: number;
  loaningPool: number;
  kits: ChamaKit[];
  interestAccrued: number;
  interestCollected: number;
  repaidPrincipal: number;
  totalContributions: number;
  completedContributions: Contribution[];
  reserveBalance: number;
  opsCard: string | null;
  setOpsCard: (id: string | null) => void;
  monthLabel: string;
  ledger: { id: string; chamaId: string; description: string; amount: number }[];
  canDisburse?: boolean;
  onDisburse?: (id: string) => void | Promise<void>;
}) {
  const liquidityCodes = new Set([
    "table-banking",
    "share-capital",
    "general-savings",
    "member-loans",
  ]);
  const monthKey = new Date().toISOString().slice(0, 7);
  const disbursed = chamaProposals.filter((p) => p.status === "disbursed");
  const quorumVoterCount =
    members.filter((m) => m.role !== "New Applicant").length || 1;

  const exp = (p: Proposal) => {
    const schedule = p.repayment?.schedule ?? [];
    const scheduleTotal = schedule.reduce((s, x) => s + x.amount, 0);
    const originalInterest = Math.max(0, scheduleTotal - p.amount);
    const paidTotal = schedule.filter((x) => x.paid).reduce((s, x) => s + x.amount, 0);
    const interestPaid = Math.min(paidTotal, originalInterest);
    const principalPaid = Math.max(0, paidTotal - interestPaid);
    return {
      principalOut: Math.max(0, p.amount - principalPaid),
      interestOut: Math.max(0, originalInterest - interestPaid),
      interestTotal: originalInterest,
      interestPaid,
      next: schedule.find((x) => !x.paid) ?? null,
    };
  };

  const duesList = disbursed
    .map((p) => {
      const e = exp(p);
      if (!e.next) return null;
      return {
        id: p.id,
        who: members.find((m) => m.id === p.requesterId)?.name ?? "Member",
        title: p.title,
        amount: e.next.amount,
        dueDate: e.next.dueDate,
        principalOut: e.principalOut,
      };
    })
    .filter(Boolean) as {
    id: string;
    who: string;
    title: string;
    amount: number;
    dueDate: string;
    principalOut: number;
  }[];

  const disbursedThisMonth = chamaProposals.filter(
    (p) =>
      (p.status === "disbursed" || p.status === "settled") &&
      (p.disbursedAt || "").startsWith(monthKey),
  );
  const disbursedThisMonthAmt = disbursedThisMonth.reduce((s, p) => s + p.amount, 0);
  const interestExpectedThisMonth = disbursedThisMonth.reduce(
    (s, p) => s + exp(p).interestTotal,
    0,
  );

  const detailTitle: Record<string, string> = {
    balances: "Loan balances outstanding",
    available: "Available for loaning",
    dues: "Loan payments due",
    applied: "Loans applied",
    approved: "Approved for disbursement",
    "month-disb": `Disbursed · ${monthLabel}`,
    repaid: "Principal repaid",
    interest: "Interest report",
    deposits: "Member deposits",
  };

  const BookMini = ({
    id,
    label,
    value,
    sub,
  }: {
    id: string;
    label: string;
    value: string;
    sub?: string;
  }) => (
    <button
      type="button"
      onClick={() => setOpsCard(id)}
      className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-left hover:border-violet-500/40"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-base font-bold text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p> : null}
      <p className="mt-1.5 text-[10px] font-semibold text-violet-300/80">
        View details
      </p>
    </button>
  );

  const detailBody = () => {
    if (!opsCard) return null;
    if (opsCard === "balances") {
      return (
        <div className="space-y-2">
          {disbursed.length === 0 ? (
            <p className="text-xs text-slate-500">None.</p>
          ) : (
            disbursed.map((p) => {
              const e = exp(p);
              const who = members.find((m) => m.id === p.requesterId)?.name ?? "Member";
              return (
                <div
                  key={p.id}
                  className="flex justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs"
                >
                  <span className="text-slate-300">
                    {who} · {p.title}
                  </span>
                  <span className="font-mono text-rose-300">
                    {fmtKsh(e.principalOut)} + int {fmtKsh(e.interestOut)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      );
    }
    if (opsCard === "available") {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {kits
            .filter((k) => liquidityCodes.has(k.kit_code))
            .map((k) => (
              <div
                key={k.kit_code}
                className="flex justify-between rounded-xl border border-slate-800 px-3 py-2 text-xs"
              >
                <span className="text-slate-300">{k.label}</span>
                <span className="font-mono text-emerald-300">
                  {fmtKsh(Number(k.balance) || 0)}
                </span>
              </div>
            ))}
        </div>
      );
    }
    if (opsCard === "dues") {
      return (
        <div className="space-y-2">
          {duesList.length === 0 ? (
            <p className="text-xs text-slate-500">No open installments.</p>
          ) : (
            duesList.map((d) => (
              <div
                key={d.id}
                className="flex justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs"
              >
                <div>
                  <p className="font-semibold text-slate-200">
                    {d.who} · {d.title}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Due {fmtLongDate(d.dueDate)}
                  </p>
                </div>
                <span className="font-mono font-bold text-amber-300">
                  {fmtKsh(d.amount)}
                </span>
              </div>
            ))
          )}
        </div>
      );
    }
    if (opsCard === "applied") {
      return (
        <div className="space-y-2">
          {[...activeVotes, ...awaitingDisburse, ...rejected].length === 0 ? (
            <p className="text-xs text-slate-500">No applications.</p>
          ) : (
            [...activeVotes, ...awaitingDisburse, ...rejected].map((p) => {
              const who = members.find((m) => m.id === p.requesterId)?.name ?? "Member";
              const votes = Object.values(p.votes || {});
              const approve = votes.filter((v) => v === "approve").length;
              return (
                <div
                  key={p.id}
                  className="flex justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs"
                >
                  <span className="text-slate-300">
                    {who} · {p.title} · {p.status}
                  </span>
                  <span className="text-slate-500">
                    {approve}/{votes.length} approve
                  </span>
                </div>
              );
            })
          )}
        </div>
      );
    }
    if (opsCard === "approved") {
      return (
        <div className="space-y-2">
          {awaitingDisburse.length === 0 ? (
            <p className="text-xs text-slate-500">Queue empty.</p>
          ) : (
            awaitingDisburse.map((p) => {
              const who = members.find((m) => m.id === p.requesterId)?.name ?? "Member";
              return (
                <div
                  key={p.id}
                  className="flex justify-between gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs"
                >
                  <span className="text-slate-300">
                    {who} · {p.title}
                  </span>
                  <span className="font-mono text-sky-300">{fmtKsh(p.amount)}</span>
                </div>
              );
            })
          )}
        </div>
      );
    }
    if (opsCard === "month-disb") {
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Total {fmtKsh(disbursedThisMonthAmt)} · interest expected{" "}
            {fmtKsh(interestExpectedThisMonth)}
          </p>
          {disbursedThisMonth.length === 0 ? (
            <p className="text-xs text-slate-500">None this month.</p>
          ) : (
            disbursedThisMonth.map((p) => (
              <div
                key={p.id}
                className="flex justify-between rounded-xl border border-slate-800 px-3 py-2 text-xs"
              >
                <span className="text-slate-300">
                  {members.find((m) => m.id === p.requesterId)?.name ?? "Member"} ·{" "}
                  {p.title}
                </span>
                <span className="font-mono text-violet-300">{fmtKsh(p.amount)}</span>
              </div>
            ))
          )}
        </div>
      );
    }
    if (opsCard === "repaid") {
      return (
        <ul className="space-y-1 text-xs text-slate-400">
          <li>Principal repaid: {fmtKsh(repaidPrincipal)}</li>
          <li>Interest collected: {fmtKsh(interestCollected)}</li>
          <li>Settled loans: {paidLoans.length}</li>
        </ul>
      );
    }
    if (opsCard === "interest") {
      return (
        <ul className="space-y-1 text-xs text-slate-400">
          <li>Accrued: {fmtKsh(interestAccrued)}</li>
          <li>Collected: {fmtKsh(interestCollected)}</li>
          <li>Still due: {fmtKsh(outstandingInterest)}</li>
          <li>Reserve kit: {fmtKsh(reserveBalance)}</li>
        </ul>
      );
    }
    if (opsCard === "deposits") {
      return (
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {completedContributions.slice(0, 20).map((c) => (
            <div
              key={c.id}
              className="flex justify-between rounded-xl border border-slate-800 px-3 py-2 text-xs"
            >
              <span className="text-slate-300">
                {members.find((m) => m.id === c.memberId)?.name ?? "Member"} ·{" "}
                {c.destination} · {fmtLongDate(c.date)}
              </span>
              <span className="font-mono text-emerald-300">{fmtKsh(c.amount)}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Four areas · open Loan book for metrics · details open in a modal
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* 1. Loan book — summary until opened */}
        <button
          type="button"
          onClick={() =>
            setOpsCard(
              opsCard === "loan-book" ||
                (opsCard != null &&
                  !["external", "disburse-queue", "audit"].includes(opsCard))
                ? null
                : "loan-book",
            )
          }
          className={`rounded-2xl border p-4 text-left transition sm:col-span-2 ${
            opsCard === "loan-book" ||
            (opsCard != null &&
              !["external", "disburse-queue", "audit"].includes(opsCard))
              ? "border-violet-500/40 bg-violet-500/10"
              : "border-slate-800 bg-slate-900/80 hover:border-violet-500/30"
          }`}
        >
          <p className="text-sm font-bold text-white">Loan book</p>
          <p className="mt-1 font-mono text-lg font-bold text-white">
            {fmtKsh(outstandingPrincipal)}
            <span className="ml-2 text-sm font-semibold text-slate-400">
              out · lend {fmtKsh(loaningPool)}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {awaitingDisburse.length} to disburse · {duesList.length} due ·{" "}
            {activeVotes.length} in vote
          </p>
          <p className="mt-2 text-[10px] font-semibold text-violet-300/90">
            {opsCard === "loan-book" ||
            (opsCard != null &&
              !["external", "disburse-queue", "audit"].includes(opsCard))
              ? "Metrics open below · tap header to close"
              : "Tap to open metrics"}
          </p>
        </button>

        {(opsCard === "loan-book" ||
          (opsCard != null &&
            !["external", "disburse-queue", "audit"].includes(opsCard))) && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 sm:col-span-2">
            <BookMini
              id="balances"
              label="Loan balances outstanding"
              value={fmtKsh(outstandingPrincipal)}
              sub={`${fmtKsh(outstandingInterest)} interest still due`}
            />
            <BookMini
              id="available"
              label="Available for loaning"
              value={fmtKsh(loaningPool)}
              sub="available to lend"
            />
            <BookMini
              id="dues"
              label="Loan payments due"
              value={String(duesList.length)}
              sub={
                duesList[0]
                  ? `Next ${fmtKsh(duesList[0].amount)} · ${fmtLongDate(duesList[0].dueDate)}`
                  : "No upcoming installments"
              }
            />
            <BookMini
              id="applied"
              label="Loans applied"
              value={String(activeVotes.length + awaitingDisburse.length + rejected.length)}
              sub={`${activeVotes.length} voting · ${awaitingDisburse.length} approved`}
            />
            <BookMini
              id="approved"
              label="Approved for disbursement"
              value={String(awaitingDisburse.length)}
              sub={
                awaitingDisburse.length
                  ? fmtKsh(awaitingDisburse.reduce((s, p) => s + p.amount, 0))
                  : "Queue empty"
              }
            />
            <BookMini
              id="month-disb"
              label={`Disbursed · ${monthLabel}`}
              value={fmtKsh(disbursedThisMonthAmt)}
              sub={`Interest expected ${fmtKsh(interestExpectedThisMonth)}`}
            />
            <BookMini
              id="repaid"
              label="Principal repaid"
              value={fmtKsh(repaidPrincipal)}
              sub={`Interest in ${fmtKsh(interestCollected)}`}
            />
            <BookMini
              id="interest"
              label="Interest report"
              value={fmtKsh(interestAccrued)}
              sub={`Reserve ${fmtKsh(reserveBalance)}`}
            />
            <BookMini
              id="deposits"
              label="Member deposits"
              value={fmtKsh(totalContributions)}
              sub={`${completedContributions.length} records`}
            />
          </div>
        )}

        {/* 2. External */}
        <button
          type="button"
          onClick={() => setOpsCard("external")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left hover:border-sky-500/40"
        >
          <p className="text-sm font-bold text-white">External borrowing</p>
          <p className="mt-1 text-xs text-slate-400">
            Loans this chama takes from banks or other groups
          </p>
          <p className="mt-2 text-[10px] font-semibold text-slate-500">Tap to open</p>
        </button>

        {/* 3. Disbursement queue */}
        <button
          type="button"
          onClick={() => setOpsCard("disburse-queue")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left hover:border-emerald-500/40"
        >
          <p className="text-sm font-bold text-white">Disbursement queue</p>
          <p className="mt-1 font-mono text-lg font-bold text-white">
            {awaitingDisburse.length}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Treasurer pays out approved loans
          </p>
          <p className="mt-2 text-[10px] font-semibold text-slate-500">Tap to open</p>
        </button>

        {/* 4. Group activity log */}
        <button
          type="button"
          onClick={() => setOpsCard("audit")}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-left hover:border-amber-500/40 sm:col-span-2"
        >
          <p className="text-sm font-bold text-white">Group activity log</p>
          <p className="mt-1 text-xs text-slate-400">
            Recent group activity
          </p>
          <p className="mt-2 text-[10px] font-semibold text-slate-500">Tap to open</p>
        </button>
      </div>

      <AppModal
        open={opsCard === "external"}
        onClose={() => setOpsCard(null)}
        title="External borrowing"
        subtitle="Loans this chama takes from banks or other groups"
        size="lg"
        footer={
          <button type="button" className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white" onClick={() => setOpsCard(null)}>
            Close
          </button>
        }
      >
        <p className="text-xs text-slate-400">
          Member facilities stay in the Loan book. This tracks loans the chama itself takes.
        </p>
        <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-8 text-center text-[11px] text-slate-500">
          No external facilities yet
        </div>
      </AppModal>

      <AppModal
        open={opsCard === "disburse-queue"}
        onClose={() => setOpsCard(null)}
        title="Disbursement queue"
        subtitle="Treasurer pays out approved loans"
        size="lg"
        footer={
          <button type="button" className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white" onClick={() => setOpsCard(null)}>
            Close
          </button>
        }
      >
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {awaitingDisburse.length === 0 ? (
            <p className="text-xs text-slate-500">No loans waiting for disbursement.</p>
          ) : (
            awaitingDisburse.map((p) => {
              const who = members.find((m) => m.id === p.requesterId)?.name ?? "Member";
              return (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-semibold text-slate-200">{who} · {p.title}</p>
                    <p className="text-[10px] text-slate-500">{fmtKsh(p.amount)} · {p.status}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!canDisburse}
                    onClick={() => void onDisburse?.(p.id)}
                    className={`rounded-xl px-3 py-1.5 text-[11px] font-bold ${
                      canDisburse
                        ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                        : "cursor-not-allowed bg-slate-800 text-slate-500"
                    }`}
                  >
                    {canDisburse ? "Disburse" : "Treasurer only"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </AppModal>

      <AppModal
        open={opsCard === "audit"}
        onClose={() => setOpsCard(null)}
        title="Group activity log"
        subtitle="Recent high-level trail"
        size="lg"
        footer={
          <button type="button" className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white" onClick={() => setOpsCard(null)}>
            Close
          </button>
        }
      >
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {ledger
            .filter((e) => e.chamaId === chamaId)
            .slice(0, 30)
            .map((e) => (
              <div key={e.id} className="flex justify-between gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5 text-[11px]">
                <span className="truncate text-slate-400">{e.description}</span>
                <span className="shrink-0 font-mono text-slate-300">{fmtKsh(e.amount)}</span>
              </div>
            ))}
          {ledger.filter((e) => e.chamaId === chamaId).length === 0 && (
            <p className="text-xs text-slate-500">No audit events yet.</p>
          )}
        </div>
      </AppModal>

      {/* Loan book metric details → modal */}
      <AppModal
        open={Boolean(
          opsCard &&
            !["external", "disburse-queue", "audit", "loan-book"].includes(opsCard),
        )}
        onClose={() => setOpsCard("loan-book")}
        title={opsCard ? detailTitle[opsCard] || "Details" : "Details"}
        size="lg"
        footer={
          <button
            type="button"
            className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white"
            onClick={() => setOpsCard("loan-book")}
          >
            Back to loan book
          </button>
        }
      >
        <div className="max-h-[60vh] overflow-y-auto">{detailBody()}</div>
      </AppModal>
    </div>
  );
}


export default function ChamaFinance(props: ChamaFinanceProps) {
  const {
    chama,
    chamaId,
    members,
    contributions,
    proposals,
    kits,
    memberBalances,
    ledger,
  } = props;

  const me = members.find((m) => m.isCurrentUser);
  const isOfficial =
    me?.role === "Chairperson" ||
    me?.role === "Treasurer" ||
    me?.role === "Secretary";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [
          plansRes,
          pendingRes,
          welfareRes,
          penRes,
          buckRes,
          expRes,
          dashRes,
          arrRes,
        ] = await Promise.all([
          supabase.rpc("list_contribution_plans", { p_chama_id: chamaId }),
          supabase.rpc("list_pending_contributions", { p_chama_id: chamaId }),
          supabase.rpc("list_welfare_events", { p_chama_id: chamaId }),
          supabase.rpc("list_chama_penalties", { p_chama_id: chamaId }),
          supabase.rpc("list_welfare_buckets", { p_chama_id: chamaId }),
          supabase.rpc("list_welfare_expense_requests", { p_chama_id: chamaId }),
          supabase.rpc("chama_obligation_dashboard", { p_chama_id: chamaId }),
          supabase.rpc("chama_arrears_report", { p_chama_id: chamaId }),
        ]);
        if (!cancelled) {
          if (!plansRes.error) {
            setPlans((Array.isArray(plansRes.data) ? plansRes.data : []) as ContributionPlan[]);
          }
          if (!pendingRes.error) {
            setPendingPays(
              (Array.isArray(pendingRes.data) ? pendingRes.data : []) as typeof pendingPays,
            );
          }
          if (!welfareRes.error) {
            setWelfareEvents(
              (Array.isArray(welfareRes.data) ? welfareRes.data : []) as typeof welfareEvents,
            );
          }
          if (!penRes.error) {
            setPenaltyList(
              (Array.isArray(penRes.data) ? penRes.data : []) as typeof penaltyList,
            );
          }
          if (!buckRes.error) {
            setWelfareBuckets(
              (Array.isArray(buckRes.data) ? buckRes.data : []) as typeof welfareBuckets,
            );
          }
          if (!expRes.error) {
            setWelfareExpReqs(
              (Array.isArray(expRes.data) ? expRes.data : []) as typeof welfareExpReqs,
            );
          }
          if (!dashRes.error && dashRes.data) {
            setOblDash(dashRes.data as typeof oblDash);
          }
          if (!arrRes.error) {
            setArrears((Array.isArray(arrRes.data) ? arrRes.data : []) as typeof arrears);
          }
        }
      } catch {
        /* optional until SQL applied */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chamaId]);

  const isChair = me?.role === "Chairperson";
  const isTreasurer = me?.role === "Treasurer";

  const [reportFromYm, setReportFromYm] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [reportToYm, setReportToYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [reportPot, setReportPot] = useState<string>("all");
  const [pendingPays, setPendingPays] = useState<
    {
      id: string;
      memberId: string;
      amount: number;
      destination: string;
      method: string;
      reference: string;
      paymentDate?: string;
      paymentDetails?: string;
    }[]
  >([]);
  const [section, setSection] = useState<"command" | "operations">("command");
  const [deskPanel, setDeskPanel] = useState<
    null | "settings" | "pending" | "report" | "command" | "operations" | "expenses"
  >(null);
  const [draftEnabledKits, setDraftEnabledKits] = useState<string[] | null>(null);
  const [savingKits, setSavingKits] = useState(false);
  const [groupExpenses, setGroupExpenses] = useState<
    {
      id: string;
      category: string;
      expenseType?: string;
      description: string;
      amount: number;
      expenseDate: string;
      paymentMethod?: string;
      kitCode?: string;
      paidTo?: string;
      reference?: string;
      status?: string;
      spentBy?: string;
    }[]
  >([]);
  const [expenseForm, setExpenseForm] = useState({
    expenseType: "Stationary",
    category: "Administration",
    kitCode: "group-reserve",
    amount: "",
    paidBy: "",
    paidTo: "",
    reference: "",
    description: "",
    expenseDate: new Date().toISOString().slice(0, 10),
  });
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseReportFrom, setExpenseReportFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [expenseReportTo, setExpenseReportTo] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [settingsModal, setSettingsModal] = useState<
    null | "privacy" | "payment" | "mpesa" | "rates"
  >(null);
  const [mpesaStatus, setMpesaStatus] = useState<{
    configured?: boolean;
    shortcode?: string;
    environment?: string;
  } | null>(null);
  const [mpesaForm, setMpesaForm] = useState({
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    shortcode: "",
    shortcodeType: "paybill",
    environment: "sandbox",
    accountReference: "",
  });
  const [mpesaSaving, setMpesaSaving] = useState(false);
  const [rejectPayId, setRejectPayId] = useState<string | null>(null);
  const [treasuryCard, setTreasuryCard] = useState<
    null | "pots" | "contributions" | "welfare" | "mgr" | "shares"
  >(null);
  const [openOut, setOpenOut] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [closeCampOpen, setCloseCampOpen] = useState(false);
  const [campaignOptions, setCampaignOptions] = useState<
    { id: string; label: string; description?: string; target?: number }[]
  >([]);
  const [selectedCampId, setSelectedCampId] = useState<string | null>(null);
  const [payoutAmountOpen, setPayoutAmountOpen] = useState(false);
  const [wdOpen, setWdOpen] = useState(false);
  const [wdOptions, setWdOptions] = useState<
    { id: string; label: string; description?: string }[]
  >([]);
  const [lockOpen, setLockOpen] = useState(false);
  const [plans, setPlans] = useState<ContributionPlan[]>([]);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [welfareEvents, setWelfareEvents] = useState<
    {
      id: string;
      title: string;
      category: string;
      requiredAmount: number;
      totalCollected: number;
      totalExpected: number;
      totalOutstanding: number;
      totalExpenses: number;
      totalPayout: number;
      balance: number;
      status: string;
      beneficiaryName?: string;
    }[]
  >([]);
  const [welfareFormOpen, setWelfareFormOpen] = useState(false);
  const [treasurerPayOpen, setTreasurerPayOpen] = useState(false);
  const [pendingObligations, setPendingObligations] = useState<
    { id: string; label: string; description?: string; outstanding?: number }[]
  >([]);
  const [welfareBuckets, setWelfareBuckets] = useState<
    { bucketCode: string; label: string; balance: number }[]
  >([]);
  const [welfareExpReqs, setWelfareExpReqs] = useState<
    {
      id: string;
      title: string;
      amount: number;
      bucketCode: string;
      status: string;
      approvalMode: string;
      proposalId?: string;
    }[]
  >([]);
  const [welfareExpFormOpen, setWelfareExpFormOpen] = useState(false);
  const [oblDash, setOblDash] = useState<{
    expectedContributions?: number;
    collectedContributions?: number;
    outstandingContributions?: number;
    penaltiesAssessed?: number;
    penaltiesWaived?: number;
    groupExpenses?: number;
    activeMembers?: number;
  } | null>(null);
  const [arrears, setArrears] = useState<
    {
      memberId: string;
      planName: string;
      periodKey: string;
      outstanding: number;
      dueDate?: string;
    }[]
  >([]);

  const [penaltyList, setPenaltyList] = useState<
    { id: string; memberId: string; amount: number; status: string; reason?: string }[]
  >([]);



  const [openSettled, setOpenSettled] = useState(false);
  const [openMembers, setOpenMembers] = useState(false);
  const [openExternal, setOpenExternal] = useState(false);

  useEffect(() => {
    if (!chamaId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("list_group_expenses", {
          p_chama_id: chamaId,
          p_from: null,
          p_to: null,
        });
        if (error) throw error;
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        setGroupExpenses(
          rows.map((r: Record<string, unknown>) => ({
            id: String(r.id),
            category: String(r.category ?? ""),
            expenseType: String(r.expenseType ?? r.category ?? ""),
            description: String(r.description ?? ""),
            amount: Number(r.amount) || 0,
            expenseDate: String(r.expenseDate ?? r.expense_date ?? "").slice(0, 10),
            paymentMethod: r.paymentMethod ? String(r.paymentMethod) : undefined,
            kitCode: r.kitCode ? String(r.kitCode) : r.kit_code ? String(r.kit_code) : undefined,
            paidTo: r.paidTo ? String(r.paidTo) : r.paid_to ? String(r.paid_to) : undefined,
            reference: r.reference ? String(r.reference) : undefined,
            status: r.status ? String(r.status) : undefined,
            spentBy: r.spentBy ? String(r.spentBy) : r.spent_by ? String(r.spent_by) : undefined,
          })),
        );
      } catch (e) {
        console.warn("list_group_expenses", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chamaId, deskPanel]);

  const [opsCard, setOpsCard] = useState<string | null>(null);

  const visibleKits = useMemo(
    () => filterVisibleKits(kits, chama),
    [kits, chama],
  );

  const chamaProposals = useMemo(
    () => proposals.filter((p) => String(p.chamaId).toLowerCase() === String(chamaId).toLowerCase() && p.type === "loan"),
    [proposals, chamaId],
  );

  const outstanding = useMemo(() => {
    return chamaProposals
      .filter((p) => p.status === "disbursed")
      .map((p) => {
        const schedule = p.repayment?.schedule ?? [];
        const scheduleTotal = schedule.reduce((s, x) => s + x.amount, 0);
        const originalInterest = Math.max(0, scheduleTotal - p.amount);
        const paidTotal = schedule.filter((x) => x.paid).reduce((s, x) => s + x.amount, 0);
        const interestPaid = Math.min(paidTotal, originalInterest);
        const principalPaid = Math.max(0, paidTotal - interestPaid);
        return {
          principalOut: Math.max(0, p.amount - principalPaid),
          interestOut: Math.max(0, originalInterest - interestPaid),
          interestTotal: originalInterest,
          interestPaid,
        };
      });
  }, [chamaProposals]);

  const outstandingPrincipal = outstanding.reduce((s, x) => s + x.principalOut, 0);
  const outstandingInterest = outstanding.reduce((s, x) => s + x.interestOut, 0);
  const interestAccrued = chamaProposals
    .filter((p) => p.status === "disbursed" || p.status === "settled")
    .reduce((sum, p) => {
      const schedule = p.repayment?.schedule ?? [];
      const total = schedule.reduce((s, x) => s + x.amount, 0);
      return sum + Math.max(0, total - p.amount);
    }, 0);
  const interestCollected = outstanding.reduce((s, x) => s + x.interestPaid, 0) +
    chamaProposals
      .filter((p) => p.status === "settled")
      .reduce((sum, p) => {
        const schedule = p.repayment?.schedule ?? [];
        const total = schedule.reduce((s, x) => s + x.amount, 0);
        return sum + Math.max(0, total - p.amount);
      }, 0);

  const paidLoans = chamaProposals.filter((p) => p.status === "settled");
  const awaitingDisburse = chamaProposals.filter((p) => p.status === "approved");
  const activeVotes = chamaProposals.filter((p) => p.status === "active");

  const completedContributions = contributions.filter(
    (c) => c.chamaId === chamaId && c.status === "completed",
  );
  const totalContributions = completedContributions.reduce((s, c) => s + c.amount, 0);

  const liquidityCodes = new Set([
    "table-banking",
    "share-capital",
    "general-savings",
    "member-loans",
  ]);
  const groupPool = visibleKits.reduce((s, k) => s + (Number(k.balance) || 0), 0);
  const loaningPool = visibleKits
    .filter((k) => liquidityCodes.has(k.kit_code))
    .reduce((s, k) => s + (Number(k.balance) || 0), 0);
  const reserveKit = kits.find((k) => k.kit_code === "group-reserve");

  const contribByMember = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of completedContributions) {
      map.set(c.memberId, (map.get(c.memberId) || 0) + c.amount);
    }
    return members
      .filter((m) => m.role !== "New Applicant")
      .map((m) => ({
        member: m,
        contributed: map.get(m.id) || 0,
        balances: memberBalances
          .filter((b) => b.user_id === m.id)
          .reduce((s, b) => s + (Number(b.balance) || 0), 0),
      }))
      .sort((a, b) => b.balances - a.balances);
  }, [completedContributions, members, memberBalances]);

  const monthLabel = `${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`;

  if (!isOfficial) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70 px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950">
          <Lock size={28} className="text-slate-500" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-white">Chama Finance — leaders only</h2>
        <p className="mt-2 max-w-md text-sm text-slate-400">
          This control dashboard is for the Chairperson, Treasurer, and Secretary. Use{" "}
          <span className="font-semibold text-emerald-300">My Finance</span> for your personal
          contributions, loans, and dues.
        </p>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-5">
      <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/40 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-300/90">
              Chama finance · control desk
            </p>
            <h2 className="mt-1 text-xl font-bold text-white">{chama.name}</h2>
            <p className="mt-1 text-xs text-slate-400">
              Live group treasury · {monthLabel} · signed in as{" "}
              <span className="font-semibold text-slate-200">{me?.role}</span>
              {isTreasurer && " · you can disburse approved loans"}
              {isChair && " · you can set rates & interest rules"}
            </p>
          </div>
          <div className="flex gap-1.5 rounded-xl border border-slate-700 bg-slate-950/60 p-1">
            <button
              type="button"
              onClick={() => setSection("command")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                section === "command"
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Command view
            </button>
            <button
              type="button"
              onClick={() => setSection("operations")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                section === "operations"
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Loans & ledger ops
            </button>
          </div>
        </div>
      </div>

      
      {deskPanel === null && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Open a section for more
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button type="button" onClick={() => setDeskPanel("pending")}
              className="rounded-2xl border border-rose-500/25 bg-slate-900/80 p-4 text-left hover:border-rose-400/50">
              <p className="text-[10px] font-bold uppercase tracking-wide text-rose-300/80">Approvals</p>
              <p className="mt-1 text-2xl font-bold text-white">{pendingPays.length}</p>
              <p className="mt-1 text-xs text-slate-400">Manual payments waiting for treasurer</p>
            </button>
            <button type="button" onClick={() => { setSection("command"); setDeskPanel("command"); }}
              className="rounded-2xl border border-violet-500/25 bg-slate-900/80 p-4 text-left hover:border-violet-400/50">
              <p className="text-[10px] font-bold uppercase tracking-wide text-violet-300/80">Treasury</p>
              <p className="mt-1 text-2xl font-bold text-white">{fmtKsh(groupPool)}</p>
              <p className="mt-1 text-xs text-slate-400">Group pool · kits · overview</p>
            </button>
            <button type="button" onClick={() => { setSection("operations"); setDeskPanel("operations"); }}
              className="rounded-2xl border border-emerald-500/25 bg-slate-900/80 p-4 text-left hover:border-emerald-400/50">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-300/80">Loans & ledger</p>
              <p className="mt-1 text-sm font-bold text-white">Disburse · rates · ops</p>
              <p className="mt-1 text-xs text-slate-400">Day-to-day loan operations</p>
            </button>
            <button type="button" onClick={() => setDeskPanel("expenses")}
              className="rounded-2xl border border-orange-500/25 bg-slate-900/80 p-4 text-left hover:border-orange-400/50">
              <p className="text-[10px] font-bold uppercase tracking-wide text-orange-300/80">Expenses</p>
              <p className="mt-1 text-2xl font-bold text-white">{groupExpenses.length}</p>
              <p className="mt-1 text-xs text-slate-400">Record spend from pots · full trail</p>
            </button>
            <button type="button" onClick={() => setDeskPanel("report")}
              className="rounded-2xl border border-sky-500/25 bg-slate-900/80 p-4 text-left hover:border-sky-400/50">
              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-300/80">Reports</p>
              <p className="mt-1 text-sm font-bold text-white">Pot + expense Excel</p>
              <p className="mt-1 text-xs text-slate-400">Share with members</p>
            </button>
            <button type="button" onClick={() => setDeskPanel("settings")}
              className="rounded-2xl border border-amber-500/30 bg-slate-900/80 p-4 text-left hover:border-amber-400/50 sm:col-span-2 lg:col-span-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300/80">Settings</p>
              <p className="mt-1 text-sm font-bold text-white">Privacy · payments · M-Pesa</p>
              <p className="mt-1 text-xs text-slate-400">
                {chama.constitution?.paymentMode || "Pay mode not set"}
                {" · "}
                {chama.constitution?.memberFinanceVisibility === "all_members" ? "Open books" : "Private"}
              </p>
            </button>
          </div>
        </div>
      )}

      {deskPanel !== null && (
        <button type="button" onClick={() => setDeskPanel(null)}
          className="text-sm font-semibold text-slate-400 hover:text-white">
          ← Back to overview cards
        </button>
      )}

      {/* Settings panel */}
      {deskPanel === "settings" && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-white">Settings</h3>
          <p className="text-xs text-slate-400">
            Tap a card to change settings.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setSettingsModal("privacy")}
              className="rounded-2xl border border-sky-500/30 bg-slate-900/80 p-4 text-left hover:border-sky-400/50"
            >
              <p className="text-sm font-bold text-white">Member privacy</p>
              <p className="mt-1 text-xs text-slate-400">
                Now:{" "}
                {chama.constitution?.memberFinanceVisibility === "all_members"
                  ? "Open books"
                  : "Private (self + officials)"}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSettingsModal("payment")}
              className="rounded-2xl border border-amber-500/30 bg-slate-900/80 p-4 text-left hover:border-amber-400/50"
            >
              <p className="text-sm font-bold text-white">Payment mode</p>
              <p className="mt-1 text-xs text-slate-400">
                {chama.constitution?.paymentMode || "Not set"}
                {chama.constitution?.payToLabel
                  ? ` · ${chama.constitution.payToLabel}`
                  : ""}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSettingsModal("rates")}
              className="rounded-2xl border border-violet-500/30 bg-slate-900/80 p-4 text-left hover:border-violet-400/50"
            >
              <p className="text-sm font-bold text-white">Loan rates & interest</p>
              <p className="mt-1 text-xs text-slate-400">
                Default {chama.constitution?.loanInterestMonthlyPercent ?? 10}% / mo · reserve{" "}
                {chama.constitution?.interestReservePercent ?? 20}%
              </p>
            </button>
            <button
              type="button"
              onClick={() => setSettingsModal("mpesa")}
              className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-4 text-left hover:border-emerald-400/50"
            >
              <p className="text-sm font-bold text-white">M-Pesa setup</p>
              <p className="mt-1 text-xs text-slate-400">
                Enter Daraja credentials from Safaricom to enable STK payments.
              </p>
            </button>
          </div>

          <div className="rounded-2xl border border-orange-500/25 bg-slate-900/80 p-4">
            <p className="text-sm font-bold text-white">Active pots</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Tick the pots this chama uses, then press <strong className="text-slate-300">Save pots</strong>.
              Unticked pots are hidden on Overview, Home, My Finance, and expenses.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(() => {
                const choices = Array.from(
                  new Map(
                    [
                      ...kits.map(
                        (k) =>
                          [k.kit_code, k.label || k.kit_code] as [string, string],
                      ),
                      ...[
                        "table-banking",
                        "share-capital",
                        "general-savings",
                        "member-loans",
                        "merry-go-round",
                        "welfare",
                        "registration-fees",
                        "contingency",
                        "group-reserve",
                      ].map((code) => {
                        const lab =
                          kits.find((k) => k.kit_code === code)?.label ||
                          code;
                        return [code, lab] as [string, string];
                      }),
                    ],
                  ).entries(),
                ).filter(
                  ([code, label]) =>
                    !isRetiredWelfareExpenseKit(code, label),
                );
                const saved =
                  chama.constitution?.enabledKitCodes &&
                  chama.constitution.enabledKitCodes.length > 0
                    ? [...chama.constitution.enabledKitCodes]
                    : choices.map(([c]) => c);
                const selected = draftEnabledKits ?? saved;
                return choices.map(([code, label]) => {
                  const checked = selected.includes(code);
                  return (
                    <label
                      key={code}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-xs text-slate-200"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const base = draftEnabledKits ?? saved;
                          const next = checked
                            ? base.filter((x) => x !== code)
                            : [...base, code];
                          setDraftEnabledKits(next);
                        }}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  );
                });
              })()}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingKits || draftEnabledKits === null}
                className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white hover:bg-orange-400 disabled:opacity-40"
                onClick={async () => {
                  if (!draftEnabledKits || draftEnabledKits.length === 0) {
                    toast.error("Keep at least one pot enabled");
                    return;
                  }
                  setSavingKits(true);
                  try {
                    const constitution = {
                      ...chama.constitution,
                      enabledKitCodes: draftEnabledKits,
                      activities: draftEnabledKits as typeof chama.constitution.activities,
                    };
                    const { error } = await supabase
                      .from("chamas")
                      .update({ constitution })
                      .eq("id", chamaId);
                    if (error) throw error;
                    toast.success("Active pots saved");
                    setDraftEnabledKits(null);
                    window.setTimeout(() => window.location.reload(), 500);
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Could not save pots",
                    );
                  } finally {
                    setSavingKits(false);
                  }
                }}
              >
                {savingKits ? "Saving…" : "Save pots"}
              </button>
              {draftEnabledKits !== null && (
                <button
                  type="button"
                  className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-400"
                  onClick={() => setDraftEnabledKits(null)}
                >
                  Cancel
                </button>
              )}
              {draftEnabledKits !== null && (
                <span className="text-[10px] text-amber-300/90">
                  Unsaved changes
                </span>
              )}
            </div>
          </div>

        </div>
      )}

<div className="hidden">
        <p className="text-sm font-bold text-white">Member privacy (who sees balances)</p>
        <p className="mt-1 text-xs text-slate-400">
          Default is private: each member sees only their own amounts; officials see all.
          Switch to open books only if the group agreed.
        </p>
        <p className="mt-2 text-xs text-slate-300">
          Current:{" "}
          <span className="font-bold text-sky-300">
            {chama.constitution?.memberFinanceVisibility === "all_members"
              ? "all_members — everyone sees everyone"
              : "private — only you and officials"}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200 hover:border-sky-500/50"
            onClick={async () => {
              try {
                const constitution = {
                  ...chama.constitution,
                  memberFinanceVisibility: "private" as const,
                };
                const { error } = await supabase
                  .from("chamas")
                  .update({ constitution })
                  .eq("id", chamaId);
                if (error) throw error;
                toast.success("Privacy set to private");
                window.location.reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save");
              }
            }}
          >
            Set private
          </button>
          <button
            type="button"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/20"
            onClick={async () => {
              if (
                !window.confirm(
                  "Make individual balances visible to ALL members? Only do this if the chama agreed in writing.",
                )
              )
                return;
              try {
                const constitution = {
                  ...chama.constitution,
                  memberFinanceVisibility: "all_members" as const,
                };
                const { error } = await supabase
                  .from("chamas")
                  .update({ constitution })
                  .eq("id", chamaId);
                if (error) throw error;
                toast.success("Open books: all members can see individual balances");
                window.location.reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not save");
              }
            }}
          >
            Set open books (all members)
          </button>
        </div>
      </div>

      

      {/* Expenses desk */}
      <div className={`space-y-4 ${deskPanel === "expenses" ? "" : "hidden"}`}>
        <div className="rounded-2xl border border-orange-500/30 bg-slate-900/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-white">Pots (live)</p>
              <p className="text-[11px] text-slate-500">
                Tap a pot — expense comes from that balance
              </p>
            </div>
          </div>
          <div className="mt-2 flex max-h-[4.75rem] flex-wrap gap-1.5 overflow-y-auto">
            {visibleKits
              .slice()
              .sort((a, b) => a.kit_code.localeCompare(b.kit_code))
              .map((k) => (
                <button
                  key={k.kit_code}
                  type="button"
                  onClick={() =>
                    setExpenseForm((f) => ({ ...f, kitCode: k.kit_code }))
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left ${
                    expenseForm.kitCode === k.kit_code
                      ? "border-orange-500/60 bg-orange-500/15"
                      : "border-slate-800 bg-slate-950/60 hover:border-slate-600"
                  }`}
                >
                  <span className="max-w-[7.5rem] truncate text-[10px] font-semibold text-slate-300">
                    {k.label || k.kit_code}
                  </span>
                  <span className="font-mono text-[10px] font-bold text-white">
                    {fmtKsh(Number(k.balance) || 0)}
                  </span>
                </button>
              ))}
            {kits.length === 0 && (
              <p className="text-xs text-slate-500">No kits loaded yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-sm font-bold text-white">Record expense</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Type of expense
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.expenseType}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, expenseType: e.target.value }))
                }
              >
                {[
                  "Stationary",
                  "Transport",
                  "Venue / hall",
                  "Refreshments",
                  "Communication",
                  "Legal / registration",
                  "Welfare support",
                  "Bank charges",
                  "Other",
                ].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Category
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.category}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, category: e.target.value }))
                }
              >
                {[
                  "Administration",
                  "Operations",
                  "Welfare",
                  "Meetings",
                  "Compliance",
                  "Other",
                ].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Pay from pot
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.kitCode}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, kitCode: e.target.value }))
                }
              >
                {visibleKits.map((k) => (
                  <option key={k.kit_code} value={k.kit_code}>
                    {k.label || k.kit_code} ({fmtKsh(Number(k.balance) || 0)})
                  </option>
                ))}
                {!visibleKits.find((k) => k.kit_code === "group-reserve") && (
                  <option value="group-reserve">Group reserve</option>
                )}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Amount (KES)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.amount}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, amount: e.target.value }))
                }
              />
            </label>
            <label className="text-xs text-slate-400">
              Who paid (from chama)
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.paidBy}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, paidBy: e.target.value }))
                }
              >
                <option value="">— Select member —</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Paid to (supplier / person)
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.paidTo}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, paidTo: e.target.value }))
                }
                placeholder="e.g. Office Mart, John"
              />
            </label>
            <label className="text-xs text-slate-400">
              Reference
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.reference}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, reference: e.target.value }))
                }
                placeholder="Receipt no. / M-Pesa code"
              />
            </label>
            <label className="text-xs text-slate-400">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.expenseDate}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, expenseDate: e.target.value }))
                }
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              Description
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={expenseForm.description}
                onChange={(e) =>
                  setExpenseForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="What was this for?"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={expenseBusy}
            className="mt-4 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-orange-400 disabled:opacity-50"
            onClick={async () => {
              const amount = Number(expenseForm.amount);
              if (!amount || amount <= 0) {
                toast.error("Enter a valid amount");
                return;
              }
              if (!expenseForm.kitCode) {
                toast.error("Select a pot");
                return;
              }
              setExpenseBusy(true);
              try {
                const paidByName =
                  members.find((m) => m.id === expenseForm.paidBy)?.name || "";
                const { error } = await supabase.rpc("record_group_expense", {
                  p_chama_id: chamaId,
                  p_category: expenseForm.category,
                  p_description:
                    expenseForm.description ||
                    `${expenseForm.expenseType} · ${expenseForm.category}`,
                  p_amount: amount,
                  p_kit_code: expenseForm.kitCode,
                  p_payment_method: "Expense",
                  p_notes: paidByName
                    ? `Paid by: ${paidByName}`
                    : null,
                  p_paid_to: expenseForm.paidTo || null,
                  p_reference: expenseForm.reference || null,
                  p_expense_type: expenseForm.expenseType,
                  p_expense_date: expenseForm.expenseDate || null,
                });
                if (error) throw error;
                toast.success(
                  `Expense ${fmtKsh(amount)} recorded from ${expenseForm.kitCode}`,
                );
                setExpenseForm((f) => ({
                  ...f,
                  amount: "",
                  description: "",
                  reference: "",
                  paidTo: "",
                }));
                // refresh list
                const { data } = await supabase.rpc("list_group_expenses", {
                  p_chama_id: chamaId,
                  p_from: null,
                  p_to: null,
                });
                const rows = Array.isArray(data) ? data : [];
                setGroupExpenses(
                  rows.map((r: Record<string, unknown>) => ({
                    id: String(r.id),
                    category: String(r.category ?? ""),
                    expenseType: String(r.expenseType ?? r.category ?? ""),
                    description: String(r.description ?? ""),
                    amount: Number(r.amount) || 0,
                    expenseDate: String(
                      r.expenseDate ?? r.expense_date ?? "",
                    ).slice(0, 10),
                    kitCode: r.kitCode
                      ? String(r.kitCode)
                      : r.kit_code
                        ? String(r.kit_code)
                        : undefined,
                    paidTo: r.paidTo
                      ? String(r.paidTo)
                      : r.paid_to
                        ? String(r.paid_to)
                        : undefined,
                    reference: r.reference ? String(r.reference) : undefined,
                    spentBy: r.spentBy
                      ? String(r.spentBy)
                      : r.spent_by
                        ? String(r.spent_by)
                        : undefined,
                  })),
                );
                // soft reload kits via parent refresh if available
                window.setTimeout(() => window.location.reload(), 800);
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Could not record expense",
                );
              } finally {
                setExpenseBusy(false);
              }
            }}
          >
            {expenseBusy ? "Saving…" : "Post expense"}
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-sm font-bold text-white">Expense register</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="py-1.5 pr-2">Date</th>
                  <th className="py-1.5 pr-2">Type</th>
                  <th className="py-1.5 pr-2">Category</th>
                  <th className="py-1.5 pr-2">Pot</th>
                  <th className="py-1.5 pr-2">Paid to</th>
                  <th className="py-1.5 pr-2">Ref</th>
                  <th className="py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {groupExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-slate-500">
                      No expenses yet. Record one above.
                    </td>
                  </tr>
                ) : (
                  groupExpenses.map((e) => (
                    <tr key={e.id} className="border-b border-slate-800/80">
                      <td className="py-1.5 text-slate-400">{e.expenseDate}</td>
                      <td className="py-1.5 text-slate-200">
                        {e.expenseType || e.category}
                      </td>
                      <td className="py-1.5 text-slate-400">{e.category}</td>
                      <td className="py-1.5 text-slate-400">{e.kitCode || "—"}</td>
                      <td className="py-1.5 text-slate-400">{e.paidTo || "—"}</td>
                      <td className="py-1.5 text-slate-500">{e.reference || "—"}</td>
                      <td className="py-1.5 text-right font-mono font-semibold text-orange-200">
                        {fmtKsh(e.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={`rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-4 ${deskPanel === "report" ? "" : "hidden"}`}>
        <p className="text-sm font-bold text-white">Monthly pot report (Excel)</p>
        <p className="mt-1 text-xs text-slate-400">
          Download a spreadsheet of who paid into each pot by month. Share with members to see months paid and not paid.
          Opens in Excel or Google Sheets.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">
            From month
            <input
              type="month"
              value={reportFromYm}
              onChange={(e) => setReportFromYm(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400">
            To month
            <input
              type="month"
              value={reportToYm}
              onChange={(e) => setReportToYm(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400">
            Pot
            <select
              value={reportPot}
              onChange={(e) => setReportPot(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            >
              <option value="all">All pots combined</option>
              <option value="table-banking">Table banking</option>
              <option value="share-capital">Share capital</option>
              <option value="merry-go-round">Merry-go-round</option>
              <option value="general-savings">General savings</option>
              <option value="welfare">Welfare</option>
              <option value="registration-fees">Registration</option>
              <option value="member-loans">Member loans fund</option>
              <option value="contingency">Contingency</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-400"
            onClick={() => {
              try {
                const from = reportFromYm;
                const to = reportToYm;
                if (!from || !to || from > to) {
                  toast.error("Choose a valid from / to month range");
                  return;
                }
                const { months, totals } = buildMonthlyPotMatrix({
                  members,
                  contributions,
                  potCode: reportPot === "all" ? "all" : reportPot,
                  fromYm: from,
                  toYm: to,
                });
                if (months.length === 0) {
                  toast.error("No months in that range");
                  return;
                }
                const csv = monthlyPotMatrixToCsv({
                  chamaName: chama.name,
                  potCode: reportPot === "all" ? "all" : reportPot,
                  members,
                  months,
                  totals,
                });
                const potPart =
                  reportPot === "all" ? "all-pots" : reportPot;
                const fname = `chamavault-${chama.name.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 24)}-${potPart}-${from}_${to}.csv`;
                downloadTextFile(fname, csv);
                toast.success("Report downloaded — open in Excel to print or share");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Export failed");
              }
            }}
          >
            Download pot Excel
          </button>
        </div>

        <div className="mt-8 border-t border-slate-800 pt-5">
          <p className="text-sm font-bold text-white">Expense report (Excel)</p>
          <p className="mt-1 text-xs text-slate-400">
            Download expenses for a date range to share with members for accountability.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">
              From
              <input
                type="date"
                value={expenseReportFrom}
                onChange={(e) => setExpenseReportFrom(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              To
              <input
                type="date"
                value={expenseReportTo}
                onChange={(e) => setExpenseReportTo(e.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <button
              type="button"
              className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-400"
              onClick={() => {
                const from = expenseReportFrom;
                const to = expenseReportTo;
                if (!from || !to || from > to) {
                  toast.error("Choose a valid from / to date range");
                  return;
                }
                const rows = groupExpenses.filter(
                  (e) => e.expenseDate >= from && e.expenseDate <= to,
                );
                const lines = [
                  "ChamaVault expense report",
                  `Chama,${chama.name}`,
                  `From,${from}`,
                  `To,${to}`,
                  "",
                  "Date,Type,Category,Pot,Description,Paid to,Reference,Amount",
                  ...rows.map(
                    (e) =>
                      `${e.expenseDate},${JSON.stringify(e.expenseType || "")},${JSON.stringify(e.category)},${e.kitCode || ""},${JSON.stringify(e.description)},${JSON.stringify(e.paidTo || "")},${JSON.stringify(e.reference || "")},${e.amount}`,
                  ),
                  "",
                  `Total,, , , , , ,${rows.reduce((s, e) => s + e.amount, 0)}`,
                ];
                const csv = lines.join("\n");
                const blob = new Blob([csv], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `chamavault-expenses-${chama.name.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 20)}-${from}_${to}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success(
                  rows.length
                    ? `Downloaded ${rows.length} expense row(s)`
                    : "Downloaded empty report (no expenses in range)",
                );
              }}
            >
              Download expense Excel
            </button>
          </div>
        </div>
      </div>


      <div className="hidden">
        <p className="text-sm font-bold text-white">How members pay</p>
        <p className="mt-1 text-xs text-slate-400">
          <strong className="text-slate-300">Manual:</strong> member pays till/cash, records in app, you approve.
          {" "}
          <strong className="text-slate-300">M-Pesa STK:</strong> member enters PIN on phone; money posts when confirmed.
        </p>
        <p className="mt-2 text-xs text-slate-300">
          Mode:{" "}
          <span className="font-bold text-amber-200">
            {chama.constitution?.paymentMode || "manual_confirm"}
          </span>
          {chama.constitution?.payToLabel
            ? ` · Pay to: ${chama.constitution.payToLabel}`
            : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200"
            onClick={async () => {
              const mode = window.prompt(
                "Payment mode: manual_confirm | mpesa_stk | both",
                chama.constitution?.paymentMode || "manual_confirm",
              );
              if (!mode) return;
              const payTo = window.prompt(
                "Where should members pay? (Till / Paybill / phone / bank)",
                chama.constitution?.payToLabel || "",
              );
              try {
                const { error } = await supabase.rpc("set_chama_payment_mode", {
                  p_chama_id: chamaId,
                  p_mode: mode.trim(),
                  p_pay_to_label: payTo,
                  p_pay_to_phone: null,
                });
                if (error) throw error;
                toast.success("Payment mode saved");
                window.location.reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed");
              }
            }}
          >
            Set payment mode
          </button>
        </div>
      </div>

      <div className={`rounded-2xl border border-rose-500/25 bg-slate-900/80 p-4 ${deskPanel === "pending" ? "" : "hidden"}`}>
        <p className="text-sm font-bold text-white">
          Payments waiting for approval ({pendingPays.length})
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Officials can view. Only the treasurer can Approve (credits pot) or Reject.
        </p>
        {pendingPays.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No pending payments</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {pendingPays.map((p) => {
              const who = members.find((m) => m.id === p.memberId)?.name || "Member";
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5"
                >
                  <div className="min-w-0 text-xs">
                    <p className="font-bold text-white">
                      {who} · {fmtKsh(Number(p.amount))}
                    </p>
                    <p className="text-slate-500">
                      {p.destination} · {p.method} · Ref {p.reference}
                      {p.paymentDate ? ` · ${String(p.paymentDate).slice(0, 10)}` : ""}
                    </p>
                  </div>
                  {isTreasurer ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-white"
                        onClick={async () => {
                          try {
                            const { error } = await supabase.rpc(
                              "approve_pending_contribution",
                              { p_contribution_id: p.id },
                            );
                            if (error) throw error;
                            toast.success("Approved — pot updated");
                            setPendingPays((prev) => prev.filter((x) => x.id !== p.id));
                            window.location.reload();
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Approve failed");
                          }
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] font-bold text-rose-300"
                        onClick={() => setRejectPayId(p.id)}
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500">
                      Only treasurer can approve / reject
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

{(deskPanel === "command") ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-5"
        >
          {/* Snapshot — 4 numbers only */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Group pool"
              value={fmtKsh(groupPool)}
              sub="All pots combined"
              icon={<Wallet size={14} />}
              accent="emerald"
            />
            <Kpi
              label="Available to lend"
              value={fmtKsh(loaningPool)}
              sub="Loaning pool"
              icon={<Bank size={14} />}
              accent="sky"
            />
            <Kpi
              label="Loans out"
              value={fmtKsh(outstandingPrincipal)}
              sub={
                outstandingPrincipal > 0
                  ? `${fmtKsh(outstandingInterest)} interest due`
                  : "No open facilities"
              }
              icon={<HandCoins size={14} />}
              accent="rose"
            />
            <Kpi
              label="Member deposits"
              value={fmtKsh(totalContributions)}
              sub={`${completedContributions.length} records · ${awaitingDisburse.length} to disburse`}
              icon={<Coins size={14} />}
              accent="violet"
            />
          </div>

          {treasuryCard === null ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Open a group — related tools stay together
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setTreasuryCard("pots")}
                  className="rounded-2xl border border-emerald-500/25 bg-slate-900/80 p-4 text-left hover:border-emerald-400/40"
                >
                  <p className="text-sm font-bold text-white">Pots & balances</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {kits.length} kits · pool {fmtKsh(groupPool)}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTreasuryCard("contributions")}
                  className="rounded-2xl border border-sky-500/25 bg-slate-900/80 p-4 text-left hover:border-sky-400/40"
                >
                  <p className="text-sm font-bold text-white">Contributions & dues</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Plans, obligations, treasurer record pay, penalties
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTreasuryCard("welfare")}
                  className="rounded-2xl border border-teal-500/25 bg-slate-900/80 p-4 text-left hover:border-teal-400/40"
                >
                  <p className="text-sm font-bold text-white">Welfare & contingency</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Events, campaigns, welfare expenses
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTreasuryCard("mgr")}
                  className="rounded-2xl border border-amber-500/25 bg-slate-900/80 p-4 text-left hover:border-amber-400/40"
                >
                  <p className="text-sm font-bold text-white">Merry-go-round & expenses</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Rotate turns, pay beneficiary, kit expenses
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTreasuryCard("shares")}
                  className="rounded-2xl border border-violet-500/25 bg-slate-900/80 p-4 text-left hover:border-violet-400/40 sm:col-span-2"
                >
                  <p className="text-sm font-bold text-white">Shares & withdrawals</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Lock rules and pending share withdrawal requests
                  </p>
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Loans (disburse, rates, facilities) live under{" "}
                <button
                  type="button"
                  className="font-semibold text-violet-300 hover:underline"
                  onClick={() => {
                    setSection("operations");
                    setDeskPanel("operations");
                  }}
                >
                  Loans & ledger
                </button>
                . Rates under Settings.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTreasuryCard(null)}
              className="text-sm font-semibold text-slate-400 hover:text-white"
            >
              ← Back to treasury groups
            </button>
          )}

          {/* kits list when pots */}
          {treasuryCard === "pots" && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-sm font-bold text-white">Kit balances</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {visibleKits.map((k) => (
                  <div
                    key={k.kit_code}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-slate-300">{k.label}</span>
                    <span className="font-mono text-xs font-bold text-emerald-300">
                      {fmtKsh(Number(k.balance) || 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contribution plans */}

          <div className={`rounded-2xl border border-emerald-500/25 bg-slate-900/70 p-4 ${treasuryCard === "contributions" ? "" : "hidden"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-white">Contribution plans</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Set what members should pay. They will see it under What I owe.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-600 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800"
                  onClick={async () => {
                    try {
                      const { error } = await supabase.rpc(
                        "seed_default_contribution_plans",
                        { p_chama_id: chamaId },
                      );
                      if (error) throw error;
                      toast.success("Default plans seeded");
                      const { data } = await supabase.rpc("list_contribution_plans", {
                        p_chama_id: chamaId,
                      });
                      setPlans((Array.isArray(data) ? data : []) as ContributionPlan[]);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Seed failed");
                    }
                  }}
                >
                  Seed defaults
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-bold text-emerald-200"
                  onClick={() => setPlanFormOpen(true)}
                >
                  New plan
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {plans.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No plans yet. Seed defaults or create a plan.
                </p>
              ) : (
                plans.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{p.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {p.frequency} · {fmtKsh(Number(p.amount))} · kit{" "}
                        {p.destinationKit}
                        {p.dueDay ? ` · due day ${p.dueDay}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-600 px-2.5 py-1 text-[11px] font-bold text-slate-300"
                      onClick={async () => {
                        const mode = window.confirm(
                          "Apply to ALL members? OK = all, Cancel = selected only (enter user IDs next)",
                        );
                        if (mode) {
                          await supabase.rpc("set_plan_members", {
                            p_plan_id: p.id,
                            p_member_ids: null,
                          });
                          toast.success("Plan applies to all members");
                          return;
                        }
                        const raw = window.prompt(
                          "Member user IDs (comma-separated UUIDs)",
                        );
                        if (!raw) return;
                        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
                        try {
                          await supabase.rpc("set_plan_members", {
                            p_plan_id: p.id,
                            p_member_ids: ids,
                          });
                          toast.success(`Plan limited to ${ids.length} members`);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        }
                      }}
                    >
                      Who pays
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-200"
                      onClick={async () => {
                        try {
                          const { data, error } = await supabase.rpc(
                            "generate_plan_obligations",
                            {
                              p_chama_id: chamaId,
                              p_plan_id: p.id,
                              p_period_key: null,
                              p_due_date: null,
                            },
                          );
                          if (error) throw error;
                          const r = data as {
                            obligationCount?: number;
                            periodKey?: string;
                          };
                          toast.success(
                            `Period ${r.periodKey ?? ""} · ${r.obligationCount ?? 0} members (${(r as { newlyCreated?: number }).newlyCreated ?? 0} new)`,
                          );
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "Generate failed",
                          );
                        }
                      }}
                    >
                      Create dues for members
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>


          
          {/* Welfare kitty sub-funds + expense approval */}
          <div className={`rounded-2xl border border-teal-500/25 bg-slate-900/70 p-4 ${treasuryCard === "welfare" ? "" : "hidden"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-white">
          {/* Obligation-based dashboard + arrears */}
          {oblDash && treasuryCard === "contributions" && (
            <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-4">
              <p className="text-sm font-bold text-white">Contributions dashboard (from obligations)</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Members", oblDash.activeMembers],
                  ["Expected", oblDash.expectedContributions],
                  ["Collected", oblDash.collectedContributions],
                  ["Outstanding", oblDash.outstandingContributions],
                  ["Penalties", oblDash.penaltiesAssessed],
                  ["Expenses", oblDash.groupExpenses],
                ].map(([label, val]) => (
                  <div
                    key={String(label)}
                    className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                  >
                    <p className="text-[10px] font-semibold uppercase text-slate-500">
                      {label}
                    </p>
                    <p className="mt-1 font-mono text-sm font-bold text-emerald-200">
                      {label === "Members"
                        ? String(val ?? 0)
                        : fmtKsh(Number(val) || 0)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-600 px-2.5 py-1 text-[10px] font-bold text-slate-300"
                  onClick={async () => {
                    const pol = window.prompt(
                      "Who can approve spending? (officials / members / report only)",
                      "officials",
                    );
                    if (!pol) return;
                    try {
                      await supabase.rpc("set_spending_policy", {
                        p_chama_id: chamaId,
                        p_policy: pol.trim(),
                      });
                      toast.success(`Spending policy: ${pol}`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Set spending policy
                </button>
                
                <button
                  type="button"
                  className="rounded-lg border border-slate-600 px-2.5 py-1 text-[10px] font-bold text-slate-300"
                  onClick={async () => {
                    const raw = window.prompt(
                      "Allowed methods (comma-separated)",
                      "Cash,M-Pesa,Bank,Other",
                    );
                    if (!raw) return;
                    const methods = raw.split(",").map((s) => s.trim()).filter(Boolean);
                    try {
                      await supabase.rpc("set_allowed_payment_methods", {
                        p_chama_id: chamaId,
                        p_methods: methods,
                      });
                      toast.success("Payment methods updated");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Set payment methods
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-[10px] font-bold text-rose-300"
                  onClick={async () => {
                    const code = window.prompt(
                      "Kit code to remove (only if EMPTY and never funded). Standard kits cannot be removed.",
                    );
                    if (!code?.trim()) return;
                    if (
                      !window.confirm(
                        `Remove empty kit "${code.trim()}"? Blocked if it has balance or payment history.`,
                      )
                    )
                      return;
                    try {
                      const { error } = await supabase.rpc("delete_chama_kit", {
                        p_chama_id: chamaId,
                        p_kit_code: code.trim(),
                        p_force: false,
                      });
                      if (error) throw error;
                      toast.success("Empty kit removed");
                      onRefresh?.();
                    } catch (e) {
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Cannot remove — money or history exists",
                      );
                    }
                  }}
                >
                  Remove empty kit
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-amber-500/40 px-2.5 py-1 text-[10px] font-bold text-amber-200"
                  onClick={async () => {
                    const cat = window.prompt("Category?", "stationery") || "other";
                    const amt = window.prompt("Amount (KES)?");
                    if (amt == null) return;
                    const desc = window.prompt("Description?", cat) || cat;
                    try {
                      await supabase.rpc("record_group_expense", {
                        p_chama_id: chamaId,
                        p_category: cat,
                        p_description: desc,
                        p_amount: Number(amt),
                        p_kit_code: "group-reserve",
                        p_payment_method: "Other",
                        p_notes: null,
                      });
                      toast.success("Group expense recorded");
                      const { data } = await supabase.rpc("chama_obligation_dashboard", {
                        p_chama_id: chamaId,
                      });
                      if (data) setOblDash(data as typeof oblDash);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Record group expense
                </button>
              </div>
              {arrears.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-bold text-rose-300/90">Arrears</p>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {arrears.slice(0, 30).map((a, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-2 rounded-lg border border-slate-800 px-2 py-1 text-[11px]"
                      >
                        <span className="truncate text-slate-400">
                          {members.find((m) => m.id === a.memberId)?.name ?? "Member"}
                          {" · "}
                          {a.planName} ({a.periodKey})
                        </span>
                        <span className="shrink-0 font-mono text-rose-300">
                          {fmtKsh(Number(a.outstanding) || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

Welfare / emergency kitty</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Monthly and registration tracked separately. Expenses debit the chosen bucket after approval.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-teal-500/40 px-2.5 py-1 text-[10px] font-bold text-teal-200"
                  onClick={async () => {
                    try {
                      await supabase.rpc("set_channel_contributions_to_welfare", {
                        p_chama_id: chamaId,
                        p_enabled: true,
                      });
                      toast.success("New obligation payments can channel into welfare kitty");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Channel contributions → welfare
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-600 px-2.5 py-1 text-[10px] font-bold text-slate-300"
                  onClick={async () => {
                    const mode = window.prompt(
                      "Who approves expenses? (officials or members)",
                      chama.constitution?.welfareExpenseApproval ?? "officials",
                    );
                    if (!mode) return;
                    try {
                      await supabase.rpc("set_welfare_expense_approval_mode", {
                        p_chama_id: chamaId,
                        p_mode: mode.trim(),
                      });
                      toast.success(`Approval mode: ${mode}`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Set approval mode
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-200"
                  onClick={() => setWelfareExpFormOpen(true)}
                >
                  Request expense
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(welfareBuckets.length
                ? welfareBuckets
                : [
                    { bucketCode: "monthly_contribution", label: "Monthly", balance: 0 },
                    { bucketCode: "registration", label: "Registration", balance: 0 },
                    { bucketCode: "other", label: "Other", balance: 0 },
                  ]
              ).map((b) => (
                <div
                  key={b.bucketCode}
                  className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {b.label || b.bucketCode}
                  </p>
                  <p className="mt-1 font-mono text-sm font-bold text-teal-200">
                    {fmtKsh(Number(b.balance) || 0)}
                  </p>
                </div>
              ))}
            </div>
            {welfareExpReqs.filter((r) => r.status === "pending").length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] font-bold text-slate-400">Pending expenses</p>
                {welfareExpReqs
                  .filter((r) => r.status === "pending")
                  .map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="text-slate-300">
                        {r.title} · {r.bucketCode} · {fmtKsh(Number(r.amount))} ·{" "}
                        {r.approvalMode}
                      </span>
                      <div className="flex gap-2">
                        {r.approvalMode === "officials" ? (
                          <>
                            <button
                              type="button"
                              className="font-bold text-emerald-300"
                              onClick={async () => {
                                try {
                                  const { error } = await supabase.rpc(
                                    "decide_welfare_expense_official",
                                    { p_request_id: r.id, p_approve: true },
                                  );
                                  if (error) throw error;
                                  toast.success("Expense approved & paid from bucket");
                                  const { data } = await supabase.rpc(
                                    "list_welfare_buckets",
                                    { p_chama_id: chamaId },
                                  );
                                  setWelfareBuckets(
                                    (Array.isArray(data) ? data : []) as typeof welfareBuckets,
                                  );
                                  setWelfareExpReqs((prev) =>
                                    prev.map((x) =>
                                      x.id === r.id ? { ...x, status: "paid" } : x,
                                    ),
                                  );
                                } catch (e) {
                                  toast.error(
                                    e instanceof Error ? e.message : "Failed",
                                  );
                                }
                              }}
                            >
                              Approve & pay
                            </button>
                            <button
                              type="button"
                              className="font-bold text-rose-300"
                              onClick={async () => {
                                await supabase.rpc("decide_welfare_expense_official", {
                                  p_request_id: r.id,
                                  p_approve: false,
                                });
                                setWelfareExpReqs((prev) =>
                                  prev.map((x) =>
                                    x.id === r.id ? { ...x, status: "rejected" } : x,
                                  ),
                                );
                              }}
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="font-bold text-sky-300"
                            onClick={async () => {
                              try {
                                const { error } = await supabase.rpc(
                                  "execute_welfare_expense_after_vote",
                                  { p_request_id: r.id },
                                );
                                if (error) throw error;
                                toast.success("Quorum expense executed");
                                const { data } = await supabase.rpc(
                                  "list_welfare_buckets",
                                  { p_chama_id: chamaId },
                                );
                                setWelfareBuckets(
                                  (Array.isArray(data) ? data : []) as typeof welfareBuckets,
                                );
                                setWelfareExpReqs((prev) =>
                                  prev.map((x) =>
                                    x.id === r.id ? { ...x, status: "paid" } : x,
                                  ),
                                );
                              } catch (e) {
                                toast.error(
                                  e instanceof Error
                                    ? e.message
                                    : "Vote on Voting Board first, then execute",
                                );
                              }
                            }}
                          >
                            Pay out after enough votes
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

{/* Treasurer, penalties, welfare */}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc("list_chama_obligations", {
                    p_chama_id: chamaId,
                    p_plan_id: null,
                    p_period_key: null,
                  });
                  if (error) throw error;
                  const rows = (Array.isArray(data) ? data : []) as {
                    id: string;
                    planName: string;
                    memberId: string;
                    outstanding: number;
                    periodKey: string;
                    status: string;
                  }[];
                  const open = rows.filter(
                    (r) =>
                      (r.status === "pending" || r.status === "partial") &&
                      Number(r.outstanding) > 0,
                  );
                  if (!open.length) {
                    toast.message("No open obligations to record");
                    return;
                  }
                  setPendingObligations(
                    open.map((r) => {
                      const who =
                        members.find((m) => m.id === r.memberId)?.name ?? "Member";
                      return {
                        id: r.id,
                        label: `${who} · ${r.planName}`,
                        description: `${r.periodKey} · owing ${r.outstanding}`,
                        outstanding: Number(r.outstanding),
                      };
                    }),
                  );
                  setTreasurerPayOpen(true);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not load obligations",
                  );
                }
              }}
              className={`rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-left text-xs font-bold text-sky-200 hover:bg-sky-500/15 ${treasuryCard === "contributions" ? "" : "hidden"}`}
            >
              Record a member's payment
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Cash / offline — marks obligation paid for that member
              </span>
            </button>
            <button
              type="button"
              className={`rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-xs font-bold text-rose-200 hover:bg-rose-500/15 ${treasuryCard === "contributions" ? "" : "hidden"}`}
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc("assess_overdue_penalties", {
                    p_chama_id: chamaId,
                  });
                  if (error) throw error;
                  const n = (data as { assessed?: number })?.assessed ?? 0;
                  toast.success(`Assessed ${n} late penalties`);
                  const { data: pen } = await supabase.rpc("list_chama_penalties", {
                    p_chama_id: chamaId,
                  });
                  setPenaltyList(
                    (Array.isArray(pen) ? pen : []) as typeof penaltyList,
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Assess failed");
                }
              }}
            >
              Add late fines
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Uses plan penalty rules (fixed / % + grace days)
              </span>
            </button>
            <button
              type="button"
              className={`rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-left text-xs font-bold text-violet-200 hover:bg-violet-500/15 ${treasuryCard === "welfare" ? "" : "hidden"}`}
              onClick={() => setWelfareFormOpen(true)}
            >
              Create welfare event
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Bereavement, medical, emergency — generates obligations
              </span>
            </button>
          </div>

          {welfareEvents.length > 0 && treasuryCard === "welfare" && (
            <div className="rounded-2xl border border-violet-500/20 bg-slate-900/70 p-4">
              <p className="text-sm font-bold text-white">Welfare events</p>
              <div className="mt-3 space-y-2">
                {welfareEvents.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{e.title}</p>
                        <p className="text-[11px] text-slate-500">
                          {e.category}
                          {e.beneficiaryName ? ` · ${e.beneficiaryName}` : ""} ·{" "}
                          {e.status}
                        </p>
                      </div>
                      <p className="font-mono text-xs text-violet-200">
                        Bal {fmtKsh(Number(e.balance) || 0)}
                      </p>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-400 sm:grid-cols-4">
                      <span>Expected {fmtKsh(Number(e.totalExpected) || 0)}</span>
                      <span>Collected {fmtKsh(Number(e.totalCollected) || 0)}</span>
                      <span>Out {fmtKsh(Number(e.totalOutstanding) || 0)}</span>
                      <span>
                        Exp {fmtKsh(Number(e.totalExpenses) || 0)} · Pay{" "}
                        {fmtKsh(Number(e.totalPayout) || 0)}
                      </span>
                    </div>
                    {e.status !== "closed" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-slate-600 px-2 py-1 text-[10px] font-bold text-slate-300"
                          onClick={async () => {
                            const amt = window.prompt("Expense amount (KES)?");
                            if (amt == null) return;
                            const desc =
                              window.prompt("Description?", "Welfare expense") ||
                              "Welfare expense";
                            try {
                              const { error } = await supabase.rpc(
                                "record_welfare_expense",
                                {
                                  p_event_id: e.id,
                                  p_amount: Number(amt),
                                  p_description: desc,
                                },
                              );
                              if (error) throw error;
                              toast.success("Expense recorded");
                              const { data } = await supabase.rpc(
                                "list_welfare_events",
                                { p_chama_id: chamaId },
                              );
                              setWelfareEvents(
                                (Array.isArray(data) ? data : []) as typeof welfareEvents,
                              );
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Failed",
                              );
                            }
                          }}
                        >
                          Add expense
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-emerald-500/40 px-2 py-1 text-[10px] font-bold text-emerald-200"
                          onClick={async () => {
                            const amt = window.prompt(
                              "Payout to beneficiary (KES)?",
                              String(Math.max(0, Number(e.balance) || 0)),
                            );
                            if (amt == null) return;
                            try {
                              const { error } = await supabase.rpc(
                                "record_welfare_payout",
                                {
                                  p_event_id: e.id,
                                  p_amount: Number(amt),
                                  p_description: null,
                                },
                              );
                              if (error) throw error;
                              toast.success("Payout recorded");
                              const { data } = await supabase.rpc(
                                "list_welfare_events",
                                { p_chama_id: chamaId },
                              );
                              setWelfareEvents(
                                (Array.isArray(data) ? data : []) as typeof welfareEvents,
                              );
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Failed",
                              );
                            }
                          }}
                        >
                          Payout beneficiary
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {penaltyList.filter((p) => p.status === "assessed").length > 0 && treasuryCard === "contributions" && (
            <div className="rounded-2xl border border-rose-500/20 bg-slate-900/70 p-4">
              <p className="text-sm font-bold text-white">Open penalties</p>
              <div className="mt-2 space-y-1.5">
                {penaltyList
                  .filter((p) => p.status === "assessed")
                  .slice(0, 12)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="text-slate-400">
                        {members.find((m) => m.id === p.memberId)?.name ?? "Member"}
                        {" · "}
                        {p.reason || "Late penalty"}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-rose-300">
                          {fmtKsh(Number(p.amount))}
                        </span>
                        <button
                          type="button"
                          className="text-[10px] font-bold text-amber-300"
                          onClick={async () => {
                            const reason =
                              window.prompt("Waiver reason?") || "Waived by official";
                            try {
                              const { error } = await supabase.rpc("waive_penalty", {
                                p_penalty_id: p.id,
                                p_reason: reason,
                              });
                              if (error) throw error;
                              toast.success("Penalty waived");
                              setPenaltyList((prev) =>
                                prev.map((x) =>
                                  x.id === p.id ? { ...x, status: "waived" } : x,
                                ),
                              );
                            } catch (e) {
                              toast.error(
                                e instanceof Error ? e.message : "Waive failed",
                              );
                            }
                          }}
                        >
                          Waive
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

<div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc("close_contribution_cycle", {
                    p_chama_id: chamaId,
                    p_cycle_key: null,
                  });
                  if (error) throw error;
                  const r = data as { cycle?: string; finesPosted?: number; totalFines?: number };
                  toast.success(
                    `Cycle ${r.cycle ?? ""} closed · ${r.finesPosted ?? 0} fine(s) · Ksh ${r.totalFines ?? 0}`,
                  );
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not close cycle");
                }
              }}
              className={`rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-xs font-bold text-amber-200 hover:bg-amber-500/15 ${treasuryCard === "contributions" ? "" : "hidden"}`}
            >
              Close the month and post fines
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Officials · applies the group late fine
              </span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc("advance_merry_go_round", {
                    p_chama_id: chamaId,
                  });
                  if (error) throw error;
                  const r = data as { recipientName?: string };
                  toast.success(`Merry-go-round → ${r.recipientName ?? "next member"}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not advance rotation");
                }
              }}
              className={`rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-left text-xs font-bold text-sky-200 hover:bg-sky-500/15 ${treasuryCard === "mgr" ? "" : "hidden"}`}
            >
              Next merry-go-round turn
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Rotates next recipient among active members
              </span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc("mgr_payout", {
                    p_chama_id: chamaId,
                    p_beneficiary_id: null,
                    p_amount: null,
                  });
                  if (error) throw error;
                  const r = data as {
                    beneficiaryName?: string;
                    amount?: number;
                  };
                  toast.success(
                    `MGR paid ${r.beneficiaryName ?? "member"} · Ksh ${r.amount ?? 0}`,
                  );
                  window.location.reload();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "MGR payout failed");
                }
              }}
              className={`rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-left text-xs font-bold text-emerald-200 hover:bg-emerald-500/15 ${treasuryCard === "mgr" ? "" : "hidden"}`}
            >
              Pay merry-go-round beneficiary
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Pays the current merry-go-round recipient
              </span>
            </button>
            <button
              type="button"
              onClick={() => setExpenseOpen(true)}
              className={`rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-xs font-bold text-rose-200 hover:bg-rose-500/15 ${treasuryCard === "mgr" ? "" : "hidden"}`}
            >
              Record expense from a kit
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Paid from the chosen pot and recorded
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCampaignOpen(true)}
              className={`rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-left text-xs font-bold text-violet-200 hover:bg-violet-500/15 ${treasuryCard === "welfare" ? "" : "hidden"}`}
            >
              Open contingency campaign
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Members contribute to Contingency kit for this cause
              </span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc(
                    "list_contingency_campaigns",
                    { p_chama_id: chamaId },
                  );
                  if (error) throw error;
                  const rows = (Array.isArray(data) ? data : []) as {
                    id: string;
                    title: string;
                    status: string;
                    targetAmount: number;
                  }[];
                  const open = rows.filter((r) => r.status === "open");
                  if (!open.length) {
                    toast.message("No open contingency campaigns");
                    return;
                  }
                  setCampaignOptions(
                    open.map((r) => ({
                      id: r.id,
                      label: r.title,
                      description: `Target ${r.targetAmount}`,
                      target: r.targetAmount,
                    })),
                  );
                  setCloseCampOpen(true);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not load campaigns",
                  );
                }
              }}
              className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-left text-xs font-bold text-violet-200 hover:bg-violet-500/15"
            >
              Close contingency & pay out
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Pays out contingency and closes the campaign
              </span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.rpc(
                    "list_share_withdrawal_requests",
                    { p_chama_id: chamaId },
                  );
                  if (error) throw error;
                  const rows = (Array.isArray(data) ? data : []) as {
                    id: string;
                    userId: string;
                    amount: number;
                    kitCode: string;
                    status: string;
                  }[];
                  const pending = rows.filter((r) => r.status === "pending");
                  if (!pending.length) {
                    toast.message("No pending withdrawal requests");
                    return;
                  }
                  setWdOptions(
                    pending.map((r) => {
                      const who =
                        members.find((m) => m.id === r.userId)?.name ?? "Member";
                      return {
                        id: r.id,
                        label: `${who} · ${r.kitCode}`,
                        description: `KES ${r.amount}`,
                      };
                    }),
                  );
                  setWdOpen(true);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not load requests",
                  );
                }
              }}
              className={`rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-xs font-bold text-amber-200 hover:bg-amber-500/15 ${treasuryCard === "shares" ? "" : "hidden"}`}
            >
              Review share withdrawal requests
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Approve or reject pending member withdrawals
              </span>
            </button>
            <button
              type="button"
              onClick={() => setLockOpen(true)}
              className={`rounded-2xl border border-slate-600 bg-slate-800/80 px-4 py-3 text-left text-xs font-bold text-slate-200 hover:bg-slate-800 ${treasuryCard === "shares" ? "" : "hidden"}`}
            >
              Set share lock rules (chair)
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                locked / anniversary / break-up-only / exit-with-notice
              </span>
            </button>
          </div>

          <div className="hidden">
          <CollapseSection
            title="Outstanding facilities"
            subtitle="Principal still out · expand to view"
            open={openOut}
            onToggle={() => setOpenOut((v) => !v)}
            count={chamaProposals.filter((p) => p.status === "disbursed").length}
          >
            <div className="space-y-2">
{chamaProposals.filter((p) => p.status === "disbursed").length === 0 ? (
                <p className="text-xs text-slate-500">No disbursed loans outstanding.</p>
              ) : (
                chamaProposals
                  .filter((p) => p.status === "disbursed")
                  .map((p) => {
                    const schedule = p.repayment?.schedule ?? [];
                    const scheduleTotal = schedule.reduce((s, x) => s + x.amount, 0);
                    const originalInterest = Math.max(0, scheduleTotal - p.amount);
                    const paidTotal = schedule
                      .filter((x) => x.paid)
                      .reduce((s, x) => s + x.amount, 0);
                    const interestPaid = Math.min(paidTotal, originalInterest);
                    const principalPaid = Math.max(0, paidTotal - interestPaid);
                    const who =
                      members.find((m) => m.id === p.requesterId)?.name ?? "Member";
                    const next = schedule.find((x) => !x.paid);
                    return (
                      <div
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-200">
                            {who} · {p.title}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Principal left {fmtKsh(Math.max(0, p.amount - principalPaid))} ·
                            interest left {fmtKsh(Math.max(0, originalInterest - interestPaid))}
                            {next ? ` · next ${fmtKsh(next.amount)} on ${fmtLongDate(next.dueDate)}` : ""}
                          </p>
                        </div>
                        <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                          Active
                        </span>
                      </div>
                    );
                  })
              )}
            </div>
          </CollapseSection>

          <CollapseSection
            title="Settled loans"
            subtitle="Fully repaid facilities"
            open={openSettled}
            onToggle={() => setOpenSettled((v) => !v)}
            count={paidLoans.length}
          >
            <div className="space-y-2">
{paidLoans.length === 0 ? (
                <p className="text-xs text-slate-500">No fully settled loans yet.</p>
              ) : (
                paidLoans.map((p) => {
                  const who =
                    members.find((m) => m.id === p.requesterId)?.name ?? "Member";
                  const schedule = p.repayment?.schedule ?? [];
                  const total = schedule.reduce((s, x) => s + x.amount, 0);
                  const interest = Math.max(0, total - p.amount);
                  return (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-2"
                    >
                      <div>
                        <p className="text-xs font-semibold text-slate-200">
                          {who} · {p.title}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Principal {fmtKsh(p.amount)} · interest {fmtKsh(interest)}
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        Settled
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </CollapseSection>

          <CollapseSection
            title="Member contributions & balances"
            subtitle="Deposits + live kit balances · expand to view"
            open={openMembers}
            onToggle={() => setOpenMembers((v) => !v)}
            count={contribByMember.length}
          >
            <div className="overflow-x-auto">
<table className="w-full min-w-[28rem] text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="pb-2 font-semibold">Member</th>
                    <th className="pb-2 font-semibold">Role</th>
                    <th className="pb-2 text-right font-semibold">Deposited</th>
                    <th className="pb-2 text-right font-semibold">Kit balances</th>
                  </tr>
                </thead>
                <tbody>
                  {contribByMember.map(({ member, contributed, balances }) => (
                    <tr key={member.id} className="border-b border-slate-800/80">
                      <td className="py-2 font-semibold text-slate-200">{member.name}</td>
                      <td className="py-2 text-slate-500">{member.role}</td>
                      <td className="py-2 text-right font-mono text-slate-300">
                        {fmtKsh(contributed)}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-emerald-300">
                        {fmtKsh(balances || contributed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapseSection>

          <CollapseSection
            title="External loans (chama as borrower)"
            subtitle="Banks or other chamas — group debt book"
            open={openExternal}
            onToggle={() => setOpenExternal((v) => !v)}
          >
            <p className="text-xs text-slate-400">
              When this chama borrows externally, facilities will list here (lender, schedule, repayments).
              Member loans remain separate. This is the group&apos;s own external debt.
            </p>
            <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-3 py-6 text-center text-[11px] text-slate-500">
              No external facilities yet
            </div>
          </CollapseSection>
          </div>

</motion.div>
      ) : deskPanel === "operations" ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <OpsReportCards
            chama={chama}
            members={members}
            chamaProposals={chamaProposals}
            paidLoans={paidLoans}
            awaitingDisburse={awaitingDisburse}
            activeVotes={activeVotes}
            rejected={chamaProposals.filter((p) => p.status === "rejected")}
            outstandingPrincipal={outstandingPrincipal}
            outstandingInterest={outstandingInterest}
            loaningPool={loaningPool}
            kits={visibleKits}
            interestAccrued={interestAccrued}
            interestCollected={interestCollected}
            repaidPrincipal={[...chamaProposals.filter((p) => p.status === "disbursed" || p.status === "settled")].reduce((s, p) => {
              const schedule = p.repayment?.schedule ?? [];
              const scheduleTotal = schedule.reduce((a, x) => a + x.amount, 0);
              const originalInterest = Math.max(0, scheduleTotal - p.amount);
              const paidTotal = schedule.filter((x) => x.paid).reduce((a, x) => a + x.amount, 0);
              const interestPaid = Math.min(paidTotal, originalInterest);
              return s + Math.max(0, paidTotal - interestPaid);
            }, 0)}
            totalContributions={totalContributions}
            completedContributions={completedContributions}
            reserveBalance={Number(reserveKit?.balance) || 0}
            opsCard={opsCard}
            setOpsCard={setOpsCard}
            monthLabel={monthLabel}
            ledger={ledger}
            chamaId={chamaId}
            canDisburse={props.canDisburse}
            onDisburse={props.onDisburse}
          />
        </motion.div>
      ) : null}
    </div>


      <SimpleFieldsModal
        open={!!rejectPayId}
        onClose={() => setRejectPayId(null)}
        title="Reject payment"
        subtitle="Optional reason — member is not credited"
        submitLabel="Reject"
        fields={[
          { key: "reason", label: "Reason (optional)", defaultValue: "", placeholder: "e.g. Amount not received" },
        ]}
        onSubmit={async (v) => {
          if (!rejectPayId) return;
          const { error } = await supabase.rpc("reject_pending_contribution", {
            p_contribution_id: rejectPayId,
            p_reason: v.reason || null,
          });
          if (error) throw error;
          toast.message("Payment rejected");
          setPendingPays((prev) => prev.filter((x) => x.id !== rejectPayId));
          setRejectPayId(null);
        }}
      />

      <ChoiceModal
        open={settingsModal === "privacy"}
        onClose={() => setSettingsModal(null)}
        title="Member privacy"
        subtitle="Who can see individual balances on Overview"
        options={[
          {
            id: "private",
            label: "Private (recommended)",
            description: "Each member sees only their own amounts; officials see all",
          },
          {
            id: "all_members",
            label: "Open books",
            description: "All members can see each other's balances (only if AGM agreed)",
          },
        ]}
        confirmLabel="Save privacy"
        onConfirm={async (id) => {
          const constitution = {
            ...chama.constitution,
            memberFinanceVisibility: id as "private" | "all_members",
          };
          const { error } = await supabase
            .from("chamas")
            .update({ constitution })
            .eq("id", chamaId);
          if (error) throw error;
          toast.success(id === "private" ? "Privacy: private" : "Open books enabled");
          setSettingsModal(null);
          window.location.reload();
        }}
      />

      <SimpleFieldsModal
        open={settingsModal === "payment"}
        onClose={() => setSettingsModal(null)}
        title="Payment mode"
        subtitle="How members pay into the chama"
        submitLabel="Save"
        fields={[
          {
            key: "mode",
            label: "Mode (manual_confirm | mpesa_stk | both)",
            defaultValue: chama.constitution?.paymentMode || "manual_confirm",
            required: true,
          },
          {
            key: "payTo",
            label: "Pay to (till / paybill / phone for manual)",
            defaultValue: chama.constitution?.payToLabel || "",
            placeholder: "e.g. Till 123456 or 07xx…",
          },
        ]}
        onSubmit={async (v) => {
          const mode = String(v.mode || "").trim();
          if (!["manual_confirm", "mpesa_stk", "both"].includes(mode)) {
            throw new Error("Mode must be manual_confirm, mpesa_stk, or both");
          }
          const { error } = await supabase.rpc("set_chama_payment_mode", {
            p_chama_id: chamaId,
            p_mode: mode,
            p_pay_to_label: v.payTo || null,
            p_pay_to_phone: null,
          });
          if (error) throw error;
          toast.success("Payment mode saved");
          setSettingsModal(null);
          window.location.reload();
        }}
      />

      {settingsModal === "rates" && isChair && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-white">Loan rates & interest rules</p>
              <button type="button" className="text-xs font-bold text-slate-400" onClick={() => setSettingsModal(null)}>
                Close
              </button>
            </div>
            <LoanRatesChairPanel
              chama={chama}
              members={members}
              onSaveLoanRates={async (next) => {
                await props.onSaveLoanRates?.(next);
                setSettingsModal(null);
              }}
            />
          </div>
        </div>
      )}
      {settingsModal === "rates" && !isChair && (
        <AppModal open onClose={() => setSettingsModal(null)} title="Loan rates" subtitle="Only the Chairperson can change rates">
          <p className="text-sm text-slate-400">Ask the chairperson to update interest rules.</p>
        </AppModal>
      )}

      <AppModal
        open={settingsModal === "mpesa"}
        onClose={() => setSettingsModal(null)}
        title="M-Pesa / Daraja credentials"
        subtitle="From Safaricom Daraja portal — saved for this chama only"
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300"
              onClick={() => setSettingsModal(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={mpesaSaving}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              onClick={async () => {
                setMpesaSaving(true);
                try {
                  const { data, error } = await supabase.rpc(
                    "upsert_chama_mpesa_credentials",
                    {
                      p_chama_id: chamaId,
                      p_consumer_key: mpesaForm.consumerKey,
                      p_consumer_secret: mpesaForm.consumerSecret,
                      p_passkey: mpesaForm.passkey,
                      p_shortcode: mpesaForm.shortcode,
                      p_shortcode_type: mpesaForm.shortcodeType,
                      p_environment: mpesaForm.environment,
                      p_account_reference:
                        mpesaForm.accountReference || mpesaForm.shortcode,
                      p_transaction_desc: "ChamaVault",
                    },
                  );
                  if (error) throw error;
                  toast.success("M-Pesa credentials saved for this chama");
                  setMpesaStatus({
                    configured: true,
                    shortcode: mpesaForm.shortcode,
                    environment: mpesaForm.environment,
                  });
                  // Clear secrets from form memory
                  setMpesaForm((f) => ({
                    ...f,
                    consumerKey: "",
                    consumerSecret: "",
                    passkey: "",
                  }));
                  setSettingsModal(null);
                } catch (e) {
                  toast.error(
                    e instanceof Error ? e.message : "Could not save credentials",
                  );
                } finally {
                  setMpesaSaving(false);
                }
              }}
            >
              {mpesaSaving ? "Saving…" : "Save credentials"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          {mpesaStatus?.configured ? (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              Configured · shortcode {mpesaStatus.shortcode} ·{" "}
              {mpesaStatus.environment}. Re-enter secrets only if you need to change them.
            </p>
          ) : (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Not configured yet. Get keys from{" "}
              <span className="font-semibold">developer.safaricom.co.ke</span> (Daraja).
            </p>
          )}
          <label className="block text-xs text-slate-400">
            Consumer Key
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              value={mpesaForm.consumerKey}
              onChange={(e) =>
                setMpesaForm((f) => ({ ...f, consumerKey: e.target.value }))
              }
              placeholder="From Daraja app"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Consumer Secret
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              value={mpesaForm.consumerSecret}
              onChange={(e) =>
                setMpesaForm((f) => ({ ...f, consumerSecret: e.target.value }))
              }
            />
          </label>
          <label className="block text-xs text-slate-400">
            Passkey (Lipa Na M-Pesa Online)
            <input
              type="password"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              value={mpesaForm.passkey}
              onChange={(e) =>
                setMpesaForm((f) => ({ ...f, passkey: e.target.value }))
              }
            />
          </label>
          <label className="block text-xs text-slate-400">
            Business shortcode (Paybill / Till)
            <input
              type="text"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              value={mpesaForm.shortcode}
              onChange={(e) =>
                setMpesaForm((f) => ({ ...f, shortcode: e.target.value }))
              }
              placeholder="e.g. 174379"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-400">
              Type
              <select
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                value={mpesaForm.shortcodeType}
                onChange={(e) =>
                  setMpesaForm((f) => ({
                    ...f,
                    shortcodeType: e.target.value,
                  }))
                }
              >
                <option value="paybill">Paybill</option>
                <option value="till">Till</option>
              </select>
            </label>
            <label className="block text-xs text-slate-400">
              Environment
              <select
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                value={mpesaForm.environment}
                onChange={(e) =>
                  setMpesaForm((f) => ({
                    ...f,
                    environment: e.target.value,
                  }))
                }
              >
                <option value="sandbox">Sandbox (test)</option>
                <option value="production">Production (live)</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-slate-400">
            Account reference (optional)
            <input
              type="text"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              value={mpesaForm.accountReference}
              onChange={(e) =>
                setMpesaForm((f) => ({
                  ...f,
                  accountReference: e.target.value,
                }))
              }
              placeholder="Shown on M-Pesa prompt"
            />
          </label>
          <p className="text-[11px] text-slate-500">
            After saving, set <strong className="text-slate-400">How members pay</strong> to
            M-Pesa or Both. Deploy Edge functions once on the project; each chama only
            needs its own Daraja keys here.
          </p>
        </div>
      </AppModal>

      <SimpleFieldsModal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        title="Record expense from a kit"
        subtitle="Debits the kit and writes an audit trail"
        submitLabel="Post expense"
        fields={[
          {
            key: "kit",
            label: "Kit code",
            defaultValue: "registration-fees",
            placeholder: "registration-fees | contingency | group-reserve | welfare",
            required: true,
          },
          { key: "amount", label: "Amount (KES)", type: "number", required: true },
          {
            key: "description",
            label: "Description",
            defaultValue: "Group expense",
            required: true,
          },
        ]}
        onSubmit={async (v) => {
          const amount = Number(v.amount);
          if (!amount || amount <= 0) throw new Error("Enter a valid amount");
          const { error } = await supabase.rpc("record_expense_from_kit", {
            p_chama_id: chamaId,
            p_kit_code: v.kit.trim(),
            p_amount: amount,
            p_description: v.description,
            p_reference: v.kit.trim(),
            p_campaign_id: null,
          });
          if (error) throw error;
          toast.success(`Expense ${amount} from ${v.kit}`);
          window.location.reload();
        }}
      />
      <SimpleFieldsModal
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        title="Open contingency campaign"
        subtitle="Members fund the Contingency kit for this cause"
        submitLabel="Open campaign"
        fields={[
          {
            key: "title",
            label: "Campaign title",
            defaultValue: "Emergency support",
            required: true,
          },
          {
            key: "target",
            label: "Target amount (KES)",
            type: "number",
            defaultValue: "10000",
          },
        ]}
        onSubmit={async (v) => {
          const { data, error } = await supabase.rpc("create_contingency_campaign", {
            p_chama_id: chamaId,
            p_title: v.title,
            p_target: Number(v.target) || 0,
            p_notes: null,
          });
          if (error) throw error;
          toast.success(
            `Campaign opened: ${(data as { title?: string })?.title ?? v.title}`,
          );
        }}
      />
      <ChoiceModal
        open={closeCampOpen}
        onClose={() => setCloseCampOpen(false)}
        title="Close contingency campaign"
        subtitle="Select campaign, then enter payout amount"
        options={campaignOptions}
        confirmLabel="Next: amount"
        onConfirm={async (id) => {
          setSelectedCampId(id);
          setCloseCampOpen(false);
          setPayoutAmountOpen(true);
        }}
      />
      <SimpleFieldsModal
        open={payoutAmountOpen}
        onClose={() => setPayoutAmountOpen(false)}
        title="Contingency payout amount"
        subtitle={
          campaignOptions.find((o) => o.id === selectedCampId)?.label ??
          "Selected campaign"
        }
        submitLabel="Pay & close"
        fields={[
          {
            key: "amount",
            label: "Amount (KES)",
            type: "number",
            defaultValue: String(
              campaignOptions.find((o) => o.id === selectedCampId)?.target ?? "",
            ),
            required: true,
          },
        ]}
        onSubmit={async (v) => {
          if (!selectedCampId) throw new Error("No campaign selected");
          const amount = Number(v.amount);
          if (!amount || amount <= 0) throw new Error("Invalid amount");
          const camp = campaignOptions.find((o) => o.id === selectedCampId);
          const { error } = await supabase.rpc("close_contingency_campaign", {
            p_campaign_id: selectedCampId,
            p_amount: amount,
            p_description: `Contingency payout: ${camp?.label ?? ""}`,
            p_reference: "contingency",
          });
          if (error) throw error;
          toast.success(`Campaign closed · paid ${amount}`);
          window.location.reload();
        }}
      />
      <ChoiceModal
        open={wdOpen}
        onClose={() => setWdOpen(false)}
        title="Withdrawal requests"
        subtitle="Approve pays the member and debits the kit"
        options={wdOptions}
        showApproveReject
        onConfirm={async (id, approve) => {
          const { error } = await supabase.rpc("decide_share_withdrawal", {
            p_request_id: id,
            p_approve: Boolean(approve),
          });
          if (error) throw error;
          toast.success(approve ? "Withdrawal paid" : "Withdrawal rejected");
          window.location.reload();
        }}
      />
      <SimpleFieldsModal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        title="Share lock rules"
        subtitle="Chairperson only"
        submitLabel="Save rules"
        fields={[
          {
            key: "mode",
            label: "Mode (locked | anniversary | break-up-only | exit-with-notice)",
            defaultValue: chama.constitution?.shareWithdrawMode ?? "locked",
            required: true,
          },
          {
            key: "months",
            label: "Lock months",
            type: "number",
            defaultValue: String(chama.constitution?.shareLockMonths ?? 12),
          },
        ]}
        onSubmit={async (v) => {
          const { error } = await supabase.rpc("update_share_lock_settings", {
            p_chama_id: chamaId,
            p_mode: v.mode.trim(),
            p_lock_months: Math.max(1, Math.floor(Number(v.months) || 12)),
          });
          if (error) throw error;
          toast.success(`Share lock: ${v.mode} · ${v.months} months`);
        }}
      />


      <SimpleFieldsModal
        open={planFormOpen}
        onClose={() => setPlanFormOpen(false)}
        title="New contribution plan"
        subtitle="Members will owe this when you generate obligations"
        submitLabel="Save plan"
        fields={[
          { key: "name", label: "Name", defaultValue: "Monthly contribution", required: true },
          { key: "amount", label: "Amount (KES)", type: "number", required: true },
          {
            key: "frequency",
            label: "Frequency (one_off | weekly | monthly | quarterly | annually)",
            defaultValue: "monthly",
            required: true,
          },
          {
            key: "kit",
            label: "Destination kit",
            defaultValue: "table-banking",
            required: true,
          },
          { key: "dueDay", label: "Due day of month (1-28)", type: "number", defaultValue: "5" },
        ]}
        onSubmit={async (v) => {
          const amount = Number(v.amount);
          if (!amount || amount <= 0) throw new Error("Invalid amount");
          const { error } = await supabase.rpc("upsert_contribution_plan", {
            p_chama_id: chamaId,
            p_name: v.name,
            p_amount: amount,
            p_frequency: v.frequency.trim(),
            p_destination_kit: v.kit.trim(),
            p_due_day: Math.min(28, Math.max(1, Math.floor(Number(v.dueDay) || 5))),
            p_is_mandatory: true,
            p_allow_partial: false,
            p_description: null,
            p_plan_id: null,
          });
          if (error) throw error;
          toast.success(
            "Plan saved — obligations created for all active members this period",
          );
          const { data } = await supabase.rpc("list_contribution_plans", {
            p_chama_id: chamaId,
          });
          setPlans((Array.isArray(data) ? data : []) as ContributionPlan[]);
        }}
      />


      <ChoiceModal
        open={treasurerPayOpen}
        onClose={() => setTreasurerPayOpen(false)}
        title="Record payment for member"
        subtitle="Select obligation, then enter amount received"
        options={pendingObligations}
        confirmLabel="Enter amount"
        onConfirm={async (id) => {
          const row = pendingObligations.find((o) => o.id === id);
          const amtRaw = window.prompt(
            "Amount received (KES)?",
            String(row?.outstanding ?? ""),
          );
          if (amtRaw == null) return;
          const amount = Number(amtRaw);
          if (!amount || amount <= 0) throw new Error("Invalid amount");
          const method =
            window.prompt("Method (Cash / M-Pesa / Bank)?", "Cash") || "Cash";
          const { error } = await supabase.rpc(
            "record_obligation_payment_for_member",
            {
              p_obligation_id: id,
              p_amount: amount,
              p_method: method,
              p_reference: null,
              p_notes: "Treasurer recorded",
            },
          );
          if (error) throw error;
          toast.success(`Recorded ${amount} for member`);
        }}
      />
      <SimpleFieldsModal
        open={welfareFormOpen}
        onClose={() => setWelfareFormOpen(false)}
        title="Create welfare event"
        subtitle="Generates a contribution obligation for each active member"
        submitLabel="Create event"
        fields={[
          {
            key: "title",
            label: "Title",
            defaultValue: "Bereavement support",
            required: true,
          },
          {
            key: "category",
            label: "Category (death|family_death|sickness|hospitalization|accident|emergency|education|other)",
            defaultValue: "death",
            required: true,
          },
          {
            key: "amount",
            label: "Required per member (KES)",
            type: "number",
            defaultValue: "500",
            required: true,
          },
          {
            key: "beneficiary",
            label: "Beneficiary name",
            defaultValue: "",
          },
        ]}
        onSubmit={async (v) => {
          const amount = Number(v.amount);
          if (!amount || amount <= 0) throw new Error("Invalid amount");
          const { data, error } = await supabase.rpc("create_welfare_event", {
            p_chama_id: chamaId,
            p_title: v.title,
            p_category: v.category.trim(),
            p_required_amount: amount,
            p_beneficiary_id: null,
            p_beneficiary_name: v.beneficiary || null,
            p_notes: null,
            p_generate_obligations: true,
          });
          if (error) throw error;
          toast.success(
            `Event created · ${(data as { obligationCount?: number })?.obligationCount ?? 0} obligations`,
          );
          const { data: list } = await supabase.rpc("list_welfare_events", {
            p_chama_id: chamaId,
          });
          setWelfareEvents((Array.isArray(list) ? list : []) as typeof welfareEvents);
        }}
      />


      <SimpleFieldsModal
        open={welfareExpFormOpen}
        onClose={() => setWelfareExpFormOpen(false)}
        title="Request welfare expense"
        subtitle="Debits monthly_contribution, registration, or other bucket after approval"
        submitLabel="Submit request"
        fields={[
          { key: "title", label: "Title", defaultValue: "Welfare expense", required: true },
          { key: "amount", label: "Amount (KES)", type: "number", required: true },
          {
            key: "bucket",
            label: "Bucket (monthly_contribution | registration | other)",
            defaultValue: "monthly_contribution",
            required: true,
          },
          { key: "description", label: "Description", defaultValue: "" },
        ]}
        onSubmit={async (v) => {
          const amount = Number(v.amount);
          if (!amount || amount <= 0) throw new Error("Invalid amount");
          const { data, error } = await supabase.rpc("request_welfare_expense", {
            p_chama_id: chamaId,
            p_title: v.title,
            p_amount: amount,
            p_bucket_code: v.bucket.trim(),
            p_description: v.description || null,
          });
          if (error) throw error;
          const mode = (data as { approvalMode?: string })?.approvalMode;
          toast.success(
            mode === "member_quorum"
              ? "Expense sent to Voting Board for member quorum"
              : "Expense pending official approval",
          );
          const { data: list } = await supabase.rpc("list_welfare_expense_requests", {
            p_chama_id: chamaId,
          });
          setWelfareExpReqs((Array.isArray(list) ? list : []) as typeof welfareExpReqs);
        }}
      />

    </>
  );
}