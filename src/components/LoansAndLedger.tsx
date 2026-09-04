import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  ArrowsCounterClockwise,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Download,
  FileCsv,
  FunnelSimple,
  HandCoins,
  MagnifyingGlass,
  PencilSimple,
  Receipt,
  TrendUpIcon,
  Wallet,
  X,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { AuditEvent, AuditType, Chama, LoanRepaymentPlan, Member, Proposal } from "../types/chama";
import { fmtKsh, fmtDate, memberById } from "../data/mockChamaData";

interface LoansAndLedgerProps {
  chamaId: string;
  members: Member[];
  proposals: Proposal[];
  ledger: AuditEvent[];
  onRepay: (proposalId: string) => void;
}

export default function LoansAndLedger({
  chamaId,
  members,
  proposals,
  ledger,
  onRepay,
}: LoansAndLedgerProps) {
  const [tab, setTab] = useState<"loans" | "ledger">("loans");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AuditType | "all">("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");

  const loans = useMemo(
    () => proposals.filter((p) => p.chamaId === chamaId && (p.type === "loan" || p.type === "withdrawal") && p.status !== "rejected"),
    [proposals, chamaId]
  );

  const filteredLedger = useMemo(() => {
    return ledger
      .filter((e) => e.chamaId === chamaId)
      .filter((e) => typeFilter === "all" || e.type === typeFilter)
      .filter((e) => memberFilter === "all" || e.memberId === memberFilter)
      .filter((e) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          e.description.toLowerCase().includes(q) ||
          e.reference.toLowerCase().includes(q) ||
          memberById(e.memberId, members).name.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [ledger, chamaId, typeFilter, memberFilter, query, members]);

  const exportCsv = () => {
    const header = "Reference,Date,Member,Type,Description,Amount (KES)";
    const rows = filteredLedger.map((e) =>
      [
        e.reference,
        new Date(e.timestamp).toISOString(),
        `"${memberById(e.memberId, members).name}"`,
        e.type,
        `"${e.description}"`,
        e.amount,
      ].join(",")
    );
    const csvText = [header, ...rows].join(String.fromCharCode(10));
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chamavault-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ledger exported", { description: `${filteredLedger.length} entries → chamavault-ledger.csv` });
  };

  const tabs: { id: "loans" | "ledger"; label: string; badge: number; icon: React.ReactNode }[] = [
    { id: "loans", label: "Loans & Repayments", badge: loans.length, icon: <HandCoins size={15} /> },
    { id: "ledger", label: "Audit Ledger", badge: filteredLedger.length, icon: <Receipt size={15} /> },
  ];

  return (
    <section className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${
              tab === t.id
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.icon}
            {t.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                tab === t.id ? "bg-white/20 text-white" : "bg-slate-800 text-slate-400"
              }`}
            >
              {t.badge}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "loans" ? (
          <motion.div
            key="loans"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="space-y-4"
          >
            {/* Repayment calculator banner */}
            <div className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 to-slate-900 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <TrendUpIcon size={18} className="text-violet-400" />
                Loan Repayment Calculator
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Interest auto-scheduled — flat or reducing-balance. Repayments deduct from payouts or M-Pesa
                standing order, never cash.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                  12% p.a. · reducing balance
                </span>
                <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                  10% flat · welfare loans
                </span>
                <span className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                  5% table-banking penalty rule
                </span>
              </div>
            </div>

            {loans.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 py-12 text-center">
                <Wallet size={30} className="text-slate-600" />
                <p className="mt-3 text-sm font-semibold text-slate-300">No active loans</p>
                <p className="mt-1 text-xs text-slate-500">Propose a loan from the overview to start your funding vote.</p>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {loans.map((p) => (
                  <LoanCard key={p.id} proposal={p} members={members} defaultOpen={p.status === "approved"} onRepay={onRepay} />
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="ledger"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="space-y-4"
          >
            {/* Filters */}
            <div className="flex flex-col gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2">
                <MagnifyingGlass size={15} className="text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search description, reference, member..."
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-slate-500 hover:text-white" aria-label="Clear">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <FilterSelect
                  value={typeFilter}
                  onChange={(v) => setTypeFilter(v as AuditType | "all")}
                  options={[
                    ["all", "All types"],
                    ["contribution", "Contributions"],
                    ["loan-disbursed", "Loan disbursed"],
                    ["repayment", "Repayments"],
                    ["withdrawal", "Withdrawals"],
                    ["vote", "Votes"],
                    ["penalty", "Penalties"],
                  ]}
                  icon={<FunnelSimple size={14} />}
                />
                <FilterSelect
                  value={memberFilter}
                  onChange={setMemberFilter}
                  options={[
                    ["all", "All members"],
                    ...members.map((m) => [m.id, m.name.split(" ")[0]] as [string, string]),
                  ]}
                  icon={<PencilSimple size={14} />}
                />
              </div>
            </div>

            {/* Ledger table */}
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <ClockCounterClockwise size={16} className="text-emerald-400" />
                  Immutable Audit Trail
                  <span className="hidden rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 sm:inline">
                    tamper-evident references
                  </span>
                </div>
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <FileCsv size={13} className="text-emerald-400" /> CSV
                  <Download size={12} />
                </button>
              </div>

              {filteredLedger.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-center">
                  <Receipt size={28} className="text-slate-600" />
                  <p className="mt-2 text-sm font-semibold text-slate-300">No ledger entries match</p>
                  <p className="text-xs text-slate-500">Try clearing the search or filters.</p>
                </div>
              ) : (
                <div className="max-h-[520px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-900 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Ref</th>
                        <th className="px-3 py-2.5 font-semibold">Date</th>
                        <th className="px-3 py-2.5 font-semibold">Member</th>
                        <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">Event</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredLedger.map((e) => {
                        const m = memberById(e.memberId, members);
                        return (
                          <tr key={e.id} className="transition hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{e.reference}</td>
                            <td className="px-3 py-3 whitespace-nowrap text-slate-400">{fmtDate(e.timestamp)}</td>
                            <td className="px-3 py-3">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold text-white"
                                  style={{
                                    background: `linear-gradient(135deg, hsl(${m.avatarHue} 65% 42%), hsl(${(m.avatarHue + 40) % 360} 70% 30%))`,
                                  }}
                                >
                                  {m.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                                </span>
                                <span className="hidden font-medium text-slate-300 sm:inline">{m.name.split(" ")[0]}</span>
                              </span>
                            </td>
                            <td className="hidden px-3 py-3 sm:table-cell">
                              <div className="flex items-center gap-2">
                                <TypePill type={e.type} />
                                <span className="text-slate-400">{e.description}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-mono font-bold tabular-nums text-slate-200">
                              {e.type === "withdrawal" || e.type === "loan-disbursed" ? "−" : "+"}
                              {fmtKsh(e.amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ---------- Loan card ---------- */

function LoanCard({
  proposal,
  members,
  defaultOpen,
  onRepay,
}: {
  proposal: Proposal;
  members: Member[];
  defaultOpen: boolean;
  onRepay: (id: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const requester = memberById(proposal.requesterId, members);
  const plan = proposal.repayment as LoanRepaymentPlan | undefined;
  const paidCount = plan?.schedule.filter((s) => s.paid).length ?? 0;
  const totalInstallments = plan?.schedule.length ?? 0;
  const remaining = plan?.schedule.filter((s) => !s.paid).reduce((a, s) => a + s.amount, 0) ?? proposal.amount;

  const statusChip =
    proposal.status === "approved"
      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
      : proposal.status === "disbursed"
        ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
        : proposal.status === "settled"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-slate-600 bg-slate-800/60 text-slate-300";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/20 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusChip}`}>
              {proposal.status}
            </span>
            <span className="font-mono text-[10px] text-slate-500">#{proposal.id.slice(1)}</span>
          </div>
          <h3 className="mt-2 text-sm font-bold leading-snug text-white">{proposal.title}</h3>
        </div>
        <span className="shrink-0 font-mono text-lg font-bold tabular-nums text-emerald-300">{fmtKsh(proposal.amount)}</span>
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
        {proposal.disbursedAt && (
          <>
            <span className="text-slate-600">·</span>
            <span>Disbursed {fmtDate(proposal.disbursedAt)}</span>
          </>
        )}
      </div>

      {plan && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">
              Repayment {paidCount}/{totalInstallments}
            </span>
            <span className="font-mono font-bold text-slate-300">
              {fmtKsh(remaining)} outstanding · {plan.interestRate}% {plan.interestModel}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(paidCount / totalInstallments) * 100}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {proposal.status === "approved" && (
          <button
            onClick={() => onRepay(proposal.id)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98]"
          >
            <ArrowsCounterClockwise size={15} /> Repay via M-Pesa Standing Order
          </button>
        )}
        {proposal.status === "settled" && (
          <span className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-bold text-emerald-300">
            <CheckCircle size={15} weight="fill" /> Fully settled
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-center gap-1 rounded-xl border border-slate-700 px-3 py-2.5 text-[11px] font-bold text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
        >
          {open ? "Hide" : "Schedule"}
          <CaretDownMini open={open} />
        </button>
      </div>

      <AnimatePresence>
        {open && plan && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              {plan.schedule.map((s, i) => (
                <div key={s.dueDate} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    {s.paid ? (
                      <Check size={12} weight="bold" className="text-emerald-400" />
                    ) : (
                      <ArrowUpRight size={12} className="text-slate-600" />
                    )}
                    Installment {i + 1} · {fmtDate(s.dueDate)}
                  </span>
                  <span className={`font-mono font-bold ${s.paid ? "text-emerald-400" : "text-slate-300"}`}>
                    {fmtKsh(s.amount)}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Filter select ---------- */

function FilterSelect({
  value,
  onChange,
  options,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  icon: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-2 text-[11px] font-semibold text-slate-300">
        {icon}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none bg-transparent pr-4 text-[11px] font-semibold text-slate-300 outline-none"
        >
          {options.map(([v, label]) => (
            <option key={v} value={v} className="bg-slate-900 text-slate-200">
              {label}
            </option>
          ))}
        </select>
        <CaretDownMini />
      </div>
    </div>
  );
}

/* ---------- Type pill ---------- */

function TypePill({ type }: { type: AuditType }) {
  const map: Record<AuditType, { label: string; cls: string }> = {
    contribution: { label: "Contribution", cls: "bg-emerald-500/10 text-emerald-300" },
    "loan-disbursed": { label: "Disbursement", cls: "bg-sky-500/10 text-sky-300" },
    repayment: { label: "Repayment", cls: "bg-teal-500/10 text-teal-300" },
    withdrawal: { label: "Withdrawal", cls: "bg-amber-400/10 text-amber-300" },
    vote: { label: "Vote", cls: "bg-violet-500/10 text-violet-300" },
    penalty: { label: "Penalty", cls: "bg-rose-500/10 text-rose-300" },
  };
  const t = map[type];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${t.cls}`}>{t.label}</span>;
}

function CaretDownMini({ open }: { open?: boolean }) {
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
      className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}