import { useMemo, useState } from "react";
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
  Member,
  Proposal,
} from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";
import { LoanRatesChairPanel } from "./LoansAndLedger";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

type MemberBalance = { user_id: string; kit_code: string; balance: number };

interface ChamaFinanceProps {
  chama: Chama;
  chamaId: string;
  members: Member[];
  contributions: Contribution[];
  proposals: Proposal[];
  kits: ChamaKit[];
  memberBalances: MemberBalance[];
  ledger: AuditEvent[];
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
}: {
  chama: Chama;
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

  const Card = ({
    id,
    label,
    value,
    sub,
    accent,
  }: {
    id: string;
    label: string;
    value: string;
    sub?: string;
    accent: string;
  }) => {
    const open = opsCard === id;
    return (
      <button
        type="button"
        onClick={() => setOpsCard(open ? null : id)}
        className={`rounded-2xl border bg-slate-900/70 p-4 text-left transition ${
          open ? "border-violet-500/40 bg-violet-500/10" : "border-slate-800 hover:border-slate-600"
        }`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-1.5 font-mono text-lg font-bold text-white">{value}</p>
        {sub && <p className="mt-1 text-[11px] text-slate-500">{sub}</p>}
        <p className="mt-2 text-[10px] font-semibold text-slate-400">
          {open ? "Hide details" : "Tap for details"}
        </p>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Group loan book · tap a card for lists and breakdowns
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          id="balances"
          label="Loan balances outstanding"
          value={fmtKsh(outstandingPrincipal)}
          sub={`${fmtKsh(outstandingInterest)} interest still due`}
          accent="rose"
        />
        <Card
          id="available"
          label="Available for loaning"
          value={fmtKsh(loaningPool)}
          sub="4 liquidity kits"
          accent="emerald"
        />
        <Card
          id="dues"
          label="Loan payments due"
          value={String(duesList.length)}
          sub={
            duesList[0]
              ? `Next ${fmtKsh(duesList[0].amount)} · ${fmtLongDate(duesList[0].dueDate)}`
              : "No upcoming installments"
          }
          accent="amber"
        />
        <Card
          id="applied"
          label="Loans applied"
          value={String(activeVotes.length + awaitingDisburse.length + rejected.length)}
          sub={`${activeVotes.length} voting · ${awaitingDisburse.length} approved`}
          accent="violet"
        />
        <Card
          id="approved"
          label="Approved for disbursement"
          value={String(awaitingDisburse.length)}
          sub={
            awaitingDisburse.length
              ? fmtKsh(awaitingDisburse.reduce((s, p) => s + p.amount, 0))
              : "Queue empty"
          }
          accent="sky"
        />
        <Card
          id="month-disb"
          label={`Disbursed · ${monthLabel}`}
          value={fmtKsh(disbursedThisMonthAmt)}
          sub={`Interest expected ${fmtKsh(interestExpectedThisMonth)}`}
          accent="violet"
        />
        <Card
          id="repaid"
          label="Principal repaid"
          value={fmtKsh(repaidPrincipal)}
          sub={`Interest in ${fmtKsh(interestCollected)}`}
          accent="emerald"
        />
        <Card
          id="interest"
          label="Interest report"
          value={fmtKsh(interestAccrued)}
          sub={`Reserve ${fmtKsh(reserveBalance)}`}
          accent="amber"
        />
        <Card
          id="deposits"
          label="Member deposits"
          value={fmtKsh(totalContributions)}
          sub={`${completedContributions.length} records`}
          accent="sky"
        />
      </div>

      {opsCard && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
          {opsCard === "balances" && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-white">Outstanding balances</p>
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
          )}
          {opsCard === "available" && (
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
          )}
          {opsCard === "dues" && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-white">Payments due</p>
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
          )}
          {opsCard === "applied" && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-white">Applications</p>
              {[...activeVotes, ...awaitingDisburse, ...rejected].map((p) => {
                const who = members.find((m) => m.id === p.requesterId)?.name ?? "Member";
                const votes = Object.values(p.votes || {});
                const approve = votes.filter((v) => v === "approve").length;
                const need = Math.ceil(quorumVoterCount * (p.quorumThreshold || 0.6));
                return (
                  <div key={p.id} className="rounded-xl border border-slate-800 px-3 py-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-slate-200">
                        {who} · {p.title}
                      </span>
                      <span className="text-[10px] font-bold uppercase text-slate-400">
                        {p.status}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-500">
                      {fmtKsh(p.amount)} · {approve} yes votes · need {need} for quorum
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {opsCard === "approved" && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-white">Awaiting disbursement</p>
              {awaitingDisburse.map((p) => {
                const who = members.find((m) => m.id === p.requesterId)?.name ?? "Member";
                return (
                  <div
                    key={p.id}
                    className="flex justify-between rounded-xl border border-sky-500/20 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-200">
                      {who} · {p.title}
                    </span>
                    <span className="font-mono text-sky-300">{fmtKsh(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {opsCard === "month-disb" && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-white">Disbursed in {monthLabel}</p>
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
                      {fmtLongDate(p.disbursedAt || "")}
                    </span>
                    <span className="font-mono text-violet-300">{fmtKsh(p.amount)}</span>
                  </div>
                ))
              )}
            </div>
          )}
          {opsCard === "repaid" && (
            <p className="text-xs text-slate-400">
              Principal restored to kits (book): {fmtKsh(repaidPrincipal)}. Interest collected:{" "}
              {fmtKsh(interestCollected)}. See Audit Ledger for line items.
            </p>
          )}
          {opsCard === "interest" && (
            <ul className="space-y-1 text-xs text-slate-400">
              <li>Accrued: {fmtKsh(interestAccrued)}</li>
              <li>Collected: {fmtKsh(interestCollected)}</li>
              <li>Still due: {fmtKsh(outstandingInterest)}</li>
              <li>Reserve kit: {fmtKsh(reserveBalance)}</li>
            </ul>
          )}
          {opsCard === "deposits" && (
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
          )}
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-4">
        <p className="text-sm font-bold text-white">External borrowing (chama as borrower)</p>
        <p className="mt-1 text-xs text-slate-500">
          Placeholder for bank or inter-chama debt. Member facilities stay in the group loan book
          above; this section will track loans the chama itself takes.
        </p>
      </div>
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
  const isChair = me?.role === "Chairperson";
  const isTreasurer = me?.role === "Treasurer";

  const [section, setSection] = useState<"command" | "operations">("command");
  const [openOut, setOpenOut] = useState(false);
  const [openSettled, setOpenSettled] = useState(false);
  const [openMembers, setOpenMembers] = useState(false);
  const [openExternal, setOpenExternal] = useState(false);
  const [opsCard, setOpsCard] = useState<string | null>(null);

  const chamaProposals = useMemo(
    () => proposals.filter((p) => p.chamaId === chamaId && p.type === "loan"),
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
  const groupPool = kits.reduce((s, k) => s + (Number(k.balance) || 0), 0);
  const loaningPool = kits
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

      {section === "command" ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-5"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Group pool"
              value={fmtKsh(groupPool)}
              sub="All kits combined"
              icon={<Wallet size={14} />}
              accent="emerald"
            />
            <Kpi
              label="Loaning pool"
              value={fmtKsh(loaningPool)}
              sub="4 liquidity kits"
              icon={<Bank size={14} />}
              accent="sky"
            />
            <Kpi
              label="Outstanding loans"
              value={fmtKsh(outstandingPrincipal)}
              sub={`${fmtKsh(outstandingInterest)} interest still due`}
              icon={<HandCoins size={14} />}
              accent="rose"
            />
            <Kpi
              label="Interest accrued"
              value={fmtKsh(interestAccrued)}
              sub={`Collected ~ ${fmtKsh(interestCollected)} · reserve ${fmtKsh(Number(reserveKit?.balance) || 0)}`}
              icon={<TrendUp size={14} />}
              accent="amber"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Member deposits"
              value={fmtKsh(totalContributions)}
              sub={`${completedContributions.length} contribution records`}
              icon={<Coins size={14} />}
              accent="emerald"
            />
            <Kpi
              label="Awaiting disbursement"
              value={String(awaitingDisburse.length)}
              sub={isTreasurer ? "Treasurer action required" : "Treasurer disburses"}
              icon={<Receipt size={14} />}
              accent="violet"
            />
            <Kpi
              label="Open votes"
              value={String(activeVotes.length)}
              sub="Quorum-governed proposals"
              icon={<UsersThree size={14} />}
              accent="sky"
            />
            <Kpi
              label="Settled loans"
              value={String(paidLoans.length)}
              sub="Fully repaid facilities"
              icon={<ChartLineUp size={14} />}
              accent="emerald"
            />
          </div>

          {/* Status strip */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-bold text-white">Chama status</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {kits.map((k) => (
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
            <p className="mt-3 text-[11px] text-slate-500">
              Quorum {chama.constitution?.quorumPercent ?? 60}% · max loan{" "}
              {chama.constitution?.maxLoanMultiple ?? 3}× shares · default interest{" "}
              {chama.constitution?.loanInterestMonthlyPercent ?? 10}% / month flat · reserve{" "}
              {chama.constitution?.interestReservePercent ?? 20}% · split basis{" "}
              {chama.constitution?.interestSplitBasis ?? "share-capital"}
            </p>
          </div>

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
              className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-xs font-bold text-amber-200 hover:bg-amber-500/15"
            >
              Close contribution cycle & post fines
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Officials only · uses constitution late fine %
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
              className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-left text-xs font-bold text-sky-200 hover:bg-sky-500/15"
            >
              Advance merry-go-round turn
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
              className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-left text-xs font-bold text-emerald-200 hover:bg-emerald-500/15"
            >
              Pay merry-go-round beneficiary
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Debits MGR kit → audit trail + notify recipient
              </span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const kit = window.prompt(
                  "Expense from which kit code?\n(e.g. registration-fees, contingency, group-reserve, welfare)",
                  "registration-fees",
                );
                if (!kit) return;
                const amtRaw = window.prompt("Amount (KES)?", "500");
                if (amtRaw == null) return;
                const amount = Number(amtRaw);
                if (!amount || amount <= 0) {
                  toast.error("Enter a valid amount");
                  return;
                }
                const desc = window.prompt(
                  "Description / purpose?",
                  "Group expense",
                );
                if (desc == null) return;
                try {
                  const { error } = await supabase.rpc("record_expense_from_kit", {
                    p_chama_id: chamaId,
                    p_kit_code: kit.trim(),
                    p_amount: amount,
                    p_description: desc,
                    p_reference: kit.trim(),
                    p_campaign_id: null,
                  });
                  if (error) throw error;
                  toast.success(`Expense ${amount} from ${kit}`);
                  window.location.reload();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Expense failed");
                }
              }}
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-xs font-bold text-rose-200 hover:bg-rose-500/15"
            >
              Record expense from a kit
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Registration, contingency, reserve, welfare — full audit trail
              </span>
            </button>
            <button
              type="button"
              onClick={async () => {
                const title = window.prompt(
                  "Contingency campaign title?",
                  "Emergency support",
                );
                if (!title) return;
                const targetRaw = window.prompt("Target amount (KES)?", "10000");
                const target = Number(targetRaw) || 0;
                try {
                  const { data, error } = await supabase.rpc(
                    "create_contingency_campaign",
                    {
                      p_chama_id: chamaId,
                      p_title: title,
                      p_target: target,
                      p_notes: null,
                    },
                  );
                  if (error) throw error;
                  toast.success(`Campaign opened: ${(data as { title?: string })?.title ?? title}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not open campaign");
                }
              }}
              className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-left text-xs font-bold text-violet-200 hover:bg-violet-500/15"
            >
              Open contingency campaign
              <span className="mt-1 block text-[10px] font-normal text-slate-400">
                Members contribute to Contingency kit for this cause
              </span>
            </button>
          </div>

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

{/* Leader actions hint */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-white">
                <HandCoins size={18} className="text-violet-400" /> Treasurer
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {awaitingDisburse.length} loan
                {awaitingDisburse.length === 1 ? "" : "s"} awaiting disbursement. Open{" "}
                <button
                  type="button"
                  className="font-semibold text-violet-300 underline-offset-2 hover:underline"
                  onClick={() => setSection("operations")}
                >
                  Loans & ledger ops
                </button>{" "}
                to confirm applicant and disburse from the loaning pool.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-white">
                <GearSix size={18} className="text-amber-400" /> Chairperson
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {isChair
                  ? "Set monthly interest rates, reserve %, and interest split basis under Loans & ledger ops."
                  : "Only the Chairperson can change rates and interest distribution rules."}
              </p>
            </div>
          </div>
        </motion.div>
      ) : (
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
            kits={kits}
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
          />
          <LoanRatesChairPanel
            chama={props.chama}
            members={props.members}
            onSaveLoanRates={props.onSaveLoanRates}
          />

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-bold text-white">Disbursement queue</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Treasurer confirms the applicant and releases funds from the loaning pool. Personal
              repayments stay on <span className="text-emerald-300">My Finance</span>.
            </p>
            <div className="mt-3 space-y-2">
              {awaitingDisburse.length === 0 ? (
                <p className="text-xs text-slate-500">No loans waiting for disbursement.</p>
              ) : (
                awaitingDisburse.map((p) => {
                  const who =
                    members.find((m) => m.id === p.requesterId)?.name ?? "Member";
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
                          {fmtKsh(p.amount)} · status {p.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!props.canDisburse}
                        onClick={() => void props.onDisburse(p.id)}
                        className={`rounded-xl px-3 py-1.5 text-[11px] font-bold ${
                          props.canDisburse
                            ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                            : "cursor-not-allowed bg-slate-800 text-slate-500"
                        }`}
                      >
                        {props.canDisburse ? "Disburse" : "Treasurer only"}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-bold text-white">Group audit (recent)</p>
            <p className="mt-1 text-[11px] text-slate-500">
              High-level trail only — not personal loan management.
            </p>
            <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
              {ledger
                .filter((e) => e.chamaId === chamaId)
                .slice(0, 12)
                .map((e) => (
                  <div
                    key={e.id}
                    className="flex justify-between gap-2 rounded-lg border border-slate-800/80 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="truncate text-slate-400">{e.description}</span>
                    <span className="shrink-0 font-mono text-slate-300">
                      {fmtKsh(e.amount)}
                    </span>
                  </div>
                ))}
              {ledger.filter((e) => e.chamaId === chamaId).length === 0 && (
                <p className="text-xs text-slate-500">No audit events yet.</p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
