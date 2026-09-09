import { useMemo, useState } from "react";
import {
  Bank,
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
import LoansAndLedger from "./LoansAndLedger";

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

          {/* Outstanding facilities */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-bold text-white">Outstanding facilities</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Principal still out and interest still due (live from schedules)
            </p>
            <div className="mt-3 space-y-2">
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
          </div>

          {/* Paid loans */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-bold text-white">Settled loans</p>
            <div className="mt-3 space-y-2">
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
          </div>

          {/* Member contributions rollup */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-bold text-white">Member contributions & balances</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Deposits recorded + live kit balances (includes interest credits)
            </p>
            <div className="mt-3 overflow-x-auto">
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
          </div>

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
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <LoansAndLedger
            chamaId={props.chamaId}
            chama={props.chama}
            members={props.members}
            proposals={props.proposals}
            ledger={props.ledger}
            onRepay={props.onRepay}
            onReschedule={props.onReschedule}
            canDisburse={props.canDisburse}
            onDisburse={props.onDisburse}
            onBorrow={props.onBorrow}
            onPartialRepay={props.onPartialRepay}
            loanLimit={props.loanLimit}
            shareBalance={props.shareBalance}
            onSaveLoanRates={props.onSaveLoanRates}
          />
        </motion.div>
      )}
    </div>
  );
}
