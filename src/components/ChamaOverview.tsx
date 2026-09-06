import { useEffect, useState } from "react";
import {
  Bank,
  Calculator,
  HandCoins,
  PiggyBank,
  Plus,
  Receipt,
  ShieldCheck,
  TrendUp,
  UsersFour,
  WarningCircle,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { CHAMA_ACTIVITIES, type Chama, type ChamaActivity, type ChamaKit, type Contribution, type Member, type Proposal } from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";

interface ChamaOverviewProps {
  chama: Chama;
  members: Member[];
  contributions: Contribution[];
  proposals: Proposal[];
  kits?: ChamaKit[];
  currentMemberId: string;
  onContribute: () => void;
  onProposeLoan: () => void;
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: "emerald" | "gold" | "sky" | "violet";
  children?: React.ReactNode;
}) {
  const accents: Record<string, { chip: string; ring: string; text: string }> = {
    emerald: { chip: "bg-emerald-500/15 text-emerald-400", ring: "hover:border-emerald-500/40", text: "text-emerald-300" },
    gold: { chip: "bg-amber-400/15 text-amber-400", ring: "hover:border-amber-400/40", text: "text-amber-300" },
    sky: { chip: "bg-sky-500/15 text-sky-400", ring: "hover:border-sky-500/40", text: "text-sky-300" },
    violet: { chip: "bg-violet-500/15 text-violet-400", ring: "hover:border-violet-500/40", text: "text-violet-300" },
  };
  const a = accents[accent];
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/20 transition-colors ${a.ring}`}
    >
      <div className="flex items-start justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${a.chip}`}>{icon}</div>
        {children}
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold tabular-nums tracking-tight ${a.text}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </motion.div>
  );
}

export default function ChamaOverview({
  chama,
  members,
  contributions,
  proposals,
  kits = [],
  currentMemberId,
  onContribute,
  onProposeLoan,
}: ChamaOverviewProps) {
  const [viewRule, setViewRule] = useState(false);
  const activities: ChamaActivity[] = chama.constitution?.activities?.length
    ? (chama.constitution.activities as ChamaActivity[])
    : ["general-savings"];
  const [selectedAccount, setSelectedAccount] = useState<ChamaActivity>(activities[0]);
  useEffect(() => {
    if (!activities.includes(selectedAccount)) setSelectedAccount(activities[0]);
  }, [activities, selectedAccount]);
  const accountContributions = contributions.filter(
    (contribution) => contribution.status === "completed" && contribution.destination === selectedAccount,
  );
  const kitForAccount = kits.find((k) => k.kit_code === selectedAccount);
  const accountPool =
    kitForAccount != null
      ? Number(kitForAccount.balance) || 0
      : accountContributions.reduce((sum, contribution) => sum + contribution.amount, 0);
  const loanFund = kits.find((k) => k.is_loan_fund || k.kit_code === "member-loans");
  // Share-like pots only — aligns with kit_counts_toward_loan in SQL
  const shareCodes = new Set(["table-banking", "share-capital", "general-savings"]);
  const memberShareBalance = contributions
    .filter(
      (c) =>
        c.status === "completed" &&
        c.memberId === currentMemberId &&
        shareCodes.has(c.destination as string),
    )
    .reduce((sum, c) => sum + c.amount, 0);
  const maxLoanFromShares =
    memberShareBalance * (chama.constitution.maxLoanMultiple || 3);
  const pendingVotes = proposals.filter((p) => p.status === "active").length;
  const activeApproved = proposals.filter((p) => p.status === "approved").length;
  const contributionRate = Math.min(100, Math.round((accountPool / (chama.monthlyTarget || 1)) * 100));

  return (
    <section className="space-y-5">
      {/* Hero strip */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/60 p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
                {chama.kind.replace("-", " ")}
              </span>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
                {fmtKsh(chama.constitution.minMonthlyContribution)}/month
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">{chama.name}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-400">{chama.tagline}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <UsersFour size={14} className="text-emerald-400" /> {chama.memberCount} members
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-emerald-400" /> Quorum{" "}
                {chama.constitution.quorumPercent}%
              </span>
              <span className="flex items-center gap-1.5">
                <TrendUp size={14} className="text-emerald-400" /> Payout {chama.constitution.payoutCycle}
              </span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-col gap-2.5">
            <button
              onClick={onContribute}
              className="group flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-500/30 transition hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98]"
            >
              <Plus size={18} weight="bold" className="transition-transform group-hover:rotate-90" />
              Contribute Now · M-Pesa / Bank
            </button>
            <button
              onClick={onProposeLoan}
              className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-6 py-2.5 text-sm font-bold text-amber-300 transition hover:bg-amber-400/20 active:scale-[0.98]"
            >
              <HandCoins size={18} />
              Propose Loan / Withdrawal
            </button>
          </div>
        </div>

        {/* Cycle tracker */}
        <div className="relative mt-5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-[0.14em] text-slate-400">
              June contribution cycle
            </span>
            <span className="font-mono font-bold tabular-nums text-emerald-300">
              {fmtKsh(accountPool)} / {fmtKsh(chama.monthlyTarget)}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-800">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${contributionRate}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Next payout: <span className="font-semibold text-slate-300">{chama.nextPayout.recipientName}</span> ·{" "}
            {fmtKsh(chama.nextPayout.amount)} on {chama.nextPayout.dueDate}
          </p>
        </div>
      </div>

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          icon={<PiggyBank size={19} weight="fill" />}
          label="Group Pool"
          value={fmtKsh(accountPool)}
          sub={`${CHAMA_ACTIVITIES.find((item) => item.value === selectedAccount)?.label ?? selectedAccount} account`}
          accent="emerald"
        >
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            {chama.currency}
          </span>
        </MetricCard>
        <MetricCard
          icon={<HandCoins size={19} />}
          label="Pending Votes"
          value={String(pendingVotes)}
          sub="quorum-governed"
          accent="gold"
        >
          {pendingVotes > 0 && (
            <motion.span
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
              className="flex h-2.5 w-2.5 rounded-full bg-amber-400"
            />
          )}
        </MetricCard>
        <MetricCard
          icon={<Receipt size={19} />}
          label="Approved Up Next"
          value={String(activeApproved)}
          sub="awaiting disbursement"
          accent="sky"
        />
        <MetricCard
          icon={<Bank size={19} />}
          label="Total Disbursed"
          value={fmtKsh(840000)}
          sub="loans + payouts, zero cash"
          accent="violet"
        />
      </div>

      {/* Kit balances (separate pots) */}
      {kits.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h3 className="text-sm font-bold text-white">Kits (separate pots)</h3>
          <p className="mt-1 text-[11px] text-slate-500">
            Money stays in the kit you contribute to. Loan fund is separate from shares.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {kits.map((kit) => (
              <button
                key={kit.kit_code}
                type="button"
                onClick={() => {
                  if (activities.includes(kit.kit_code as ChamaActivity)) {
                    setSelectedAccount(kit.kit_code as ChamaActivity);
                  }
                }}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  selectedAccount === kit.kit_code
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-200">{kit.label}</p>
                  {kit.is_loan_fund && (
                    <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                      Loan
                    </span>
                  )}
                  {kit.counts_toward_loan_limit && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      Shares
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-sm font-bold text-emerald-300">
                  {fmtKsh(Number(kit.balance) || 0)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Constitution rule + loan calc teaser */}
      <div className="grid gap-3 lg:grid-cols-2">
        <button
          onClick={() => setViewRule((v) => !v)}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left transition hover:border-emerald-500/40"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-bold text-white">
              <ShieldCheck size={18} className="text-emerald-400" /> Zero-Cash Constitution
            </span>
            <span className="text-[11px] font-medium text-slate-500">{viewRule ? "Hide" : "View"} rules</span>
          </div>
          <AnimatedRule visible={viewRule} chama={chama} />
        </button>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Calculator size={18} className="text-violet-400" /> Loan Eligibility
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Your loan limit is based on{" "}
            <span className="font-semibold text-slate-300">your shares</span> (table banking, share
            capital, general savings), not the whole group pot. You can borrow up to{" "}
            <span className="font-mono font-bold text-slate-200">
              {fmtKsh(maxLoanFromShares)}
            </span>{" "}
            ({chama.constitution.maxLoanMultiple}× your shares of {fmtKsh(memberShareBalance)}).
            Loan payouts come from the{" "}
            <span className="font-semibold text-slate-300">
              {loanFund ? loanFund.label : "member loans"}
            </span>{" "}
            kit
            {loanFund ? ` (${fmtKsh(Number(loanFund.balance) || 0)} available)` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "No treasurer touches cash",
              "Votes ≥ quorum to execute",
              "Interest auto-computed",
              "Audit trail every event",
            ].map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-lg border border-slate-700/60 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-300"
              >
                <ShieldCheck size={12} className="text-emerald-500" /> {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Member pot progress */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white">Member savings standings</h3>
            <p className="mt-1 text-[11px] text-slate-500">Track contributions against each member&apos;s monthly target</p>
          </div>
          <select
            value={selectedAccount}
            onChange={(event) => setSelectedAccount(event.target.value as typeof selectedAccount)}
            className="max-w-[9rem] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-semibold text-slate-300 outline-none focus:border-emerald-500/60"
          >
            {activities.map((activity) => (
              <option key={activity} value={activity}>
                {CHAMA_ACTIVITIES.find((item) => item.value === activity)?.label ?? activity}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Account pool: <span className="font-mono font-semibold text-emerald-300">{fmtKsh(accountPool)}</span>
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {members.map((m) => {
            const memberPaid = accountContributions
              .filter((contribution) => contribution.memberId === m.id)
              .reduce((sum, contribution) => sum + contribution.amount, 0);
            const target = m.monthlyContribution || chama.constitution.minMonthlyContribution;
            const pct = target > 0 ? Math.min(100, Math.round((memberPaid / target) * 100)) : 0;
            const isCurrent = m.id === currentMemberId;
            return (
              <div
                key={m.id}
                className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
                  isCurrent ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800 bg-slate-950/50"
                }`}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg, hsl(${m.avatarHue} 65% 42%), hsl(${(m.avatarHue + 40) % 360} 70% 30%))`,
                  }}
                >
                  {m.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-slate-200">
                      {m.name}
                      {isCurrent && <span className="ml-1 text-[10px] font-medium text-emerald-400">(you)</span>}
                    </p>
                    <span className="font-mono text-[11px] font-bold tabular-nums text-slate-300">
                      {fmtKsh(memberPaid)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-teal-400" : "bg-amber-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                {m.activeLoans > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                    {m.activeLoans} loan
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AnimatedRule({ visible, chama }: { visible: boolean; chama: Chama }) {
  if (!visible) return null;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="overflow-hidden"
    >
      <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        {[
          {
            t: "Minimum contribution",
            v: `${fmtKsh(chama.constitution.minMonthlyContribution)} / month`,
            icon: <Plus size={13} className="text-emerald-400" />,
          },
          {
            t: "Late fine rate",
            v: `${chama.constitution.lateFineRate}% of missed contribution`,
            icon: <WarningCircle size={13} className="text-amber-400" />,
          },
          {
            t: "Voting quorum",
            v: `${chama.constitution.quorumPercent}% member approval to execute`,
            icon: <ShieldCheck size={13} className="text-emerald-400" />,
          },
          {
            t: "Max loan multiple",
            v: `${chama.constitution.maxLoanMultiple}× monthly pot`,
            icon: <HandCoins size={13} className="text-violet-400" />,
          },
        ].map((r) => (
          <div key={r.t} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              {r.icon} {r.t}
            </span>
            <span className="font-semibold text-slate-200">{r.v}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}