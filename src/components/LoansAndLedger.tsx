import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCircle,
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
import type {
  AuditEvent,
  AuditType,
  Chama,
  LoanRepaymentPlan,
  Member,
  Proposal,
} from "../types/chama";
import { fmtKsh, fmtDate, memberById } from "../data/mockChamaData";

const PAY_METHODS = [
  { id: "M-Pesa STK Push", label: "M-Pesa" },
  { id: "Airtel Money", label: "Airtel Money" },
  { id: "Bank EFT / RTGS", label: "Bank transfer" },
  { id: "PesaLink", label: "PesaLink" },
] as const;

interface LoansAndLedgerProps {
  chamaId: string;
  chama?: Chama;
  members: Member[];
  proposals: Proposal[];
  ledger: AuditEvent[];
  onRepay: (proposalId: string) => void;
  onReschedule: (
    proposalId: string,
    repayment: LoanRepaymentPlan,
    meta: { mode: "early" | "extend"; settleAmount?: number },
  ) => void;
  canDisburse: boolean;
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
  }) => void | Promise<void>;
}

function outstandingOf(p: Proposal): number {
  if (p.status === "settled") return 0;
  if (p.repayment?.schedule?.length) {
    return p.repayment.schedule
      .filter((s) => !s.paid)
      .reduce((a, s) => a + s.amount, 0);
  }
  return p.amount;
}

export default function LoansAndLedger({
  chamaId,
  chama,
  members,
  proposals,
  ledger,
  onRepay,
  onReschedule,
  canDisburse,
  onDisburse,
  onBorrow,
  onPartialRepay,
  loanLimit = 0,
  shareBalance = 0,
  onSaveLoanRates,
}: LoansAndLedgerProps) {
  const [tab, setTab] = useState<"loans" | "ledger">("loans");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AuditType | "all">("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");

  const me = members.find((m) => m.isCurrentUser);
  const isOfficial =
    me?.role === "Chairperson" ||
    me?.role === "Treasurer" ||
    me?.role === "Secretary";

  const loans = useMemo(
    () =>
      proposals.filter(
        (p) =>
          p.chamaId === chamaId &&
          (p.type === "loan" || p.type === "withdrawal") &&
          p.status !== "rejected",
      ),
    [proposals, chamaId],
  );

  const myLoans = useMemo(
    () => loans.filter((p) => p.requesterId === me?.id && p.type === "loan"),
    [loans, me?.id],
  );

  const myOutstanding = myLoans
    .filter((p) => p.status === "disbursed" || p.status === "approved")
    .reduce((s, p) => s + outstandingOf(p), 0);

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
      ].join(","),
    );
    const csvText = [header, ...rows].join("\n");
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chamavault-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Ledger exported");
  };

  const tabs: {
    id: "loans" | "ledger";
    label: string;
    badge: number;
    icon: React.ReactNode;
  }[] = [
    {
      id: "loans",
      label: "Loans & Repayments",
      badge: isOfficial ? loans.length : myLoans.length,
      icon: <HandCoins size={15} />,
    },
    {
      id: "ledger",
      label: "Audit Ledger",
      badge: filteredLedger.length,
      icon: <Receipt size={15} />,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex gap-1.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-1.5">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            onClick={() => setTab(tabItem.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${
              tab === tabItem.id
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tabItem.icon}
            {tabItem.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                tab === tabItem.id
                  ? "bg-white/20 text-white"
                  : "bg-slate-800 text-slate-400"
              }`}
            >
              {tabItem.badge}
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
            {isOfficial && (
              <LoanRatesChairPanel
                chama={chama}
                members={members}
                onSaveLoanRates={onSaveLoanRates}
              />
            )}

            {/* Bank-style actions */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Loan balance
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-amber-300">
                  {fmtKsh(myOutstanding)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Loan limit
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-emerald-300">
                  {fmtKsh(loanLimit)}
                </p>
                <p className="text-[10px] text-slate-500">
                  Shares {fmtKsh(shareBalance)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const openLoan = myLoans.find(
                    (p) =>
                      (p.status === "disbursed" || p.status === "approved") &&
                      outstandingOf(p) > 0,
                  );
                  if (!openLoan) {
                    toast.message("No open loan balance to repay");
                    return;
                  }
                  document
                    .getElementById(`loan-row-${openLoan.id}`)
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-left transition hover:bg-emerald-500/20"
              >
                <p className="text-[10px] font-semibold uppercase text-emerald-400">
                  Repay loan
                </p>
                <p className="mt-1 text-xs font-bold text-white">Pay balance</p>
              </button>
              <button
                type="button"
                onClick={() => onBorrow?.()}
                className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-left transition hover:bg-sky-500/20"
              >
                <p className="text-[10px] font-semibold uppercase text-sky-400">
                  Borrow
                </p>
                <p className="mt-1 text-xs font-bold text-white">Request loan</p>
              </button>
            </div>

            {isOfficial && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-sm font-bold text-white">All loans (officials)</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  View-only summary. Members manage their own repayments.
                </p>
                {loans.filter((p) => p.type === "loan").length === 0 ? (
                  <p className="mt-3 text-xs text-slate-500">No loans yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {loans
                      .filter((p) => p.type === "loan")
                      .map((p) => {
                        const who =
                          members.find((m) => m.id === p.requesterId)?.name ??
                          "Member";
                        const bal = outstandingOf(p);
                        return (
                          <OfficialLoanSummary
                            key={p.id}
                            proposal={p}
                            memberName={who}
                            balance={bal}
                            members={members}
                            onRepay={onRepay}
                            onReschedule={onReschedule}
                            canDisburse={canDisburse}
                            onDisburse={onDisburse}
                            onPartialRepay={undefined}
                          />
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-sm font-bold text-white">
                {isOfficial ? "My loans" : "Your loans"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Expand to view schedule and repay.
              </p>
              {myLoans.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  You have no loan applications.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {myLoans.map((p) => (
                    <MemberLoanRow
                      key={p.id}
                      proposal={p}
                      balance={outstandingOf(p)}
                      onPartialRepay={onPartialRepay}
                      members={members}
                      onRepay={onRepay}
                      onReschedule={onReschedule}
                      canDisburse={canDisburse}
                      onDisburse={onDisburse}
                    />
                  ))}
                </div>
              )}
            </div>
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
                  <button
                    onClick={() => setQuery("")}
                    className="text-slate-500 hover:text-white"
                    aria-label="Clear"
                  >
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
                    ...members.map(
                      (m) => [m.id, m.name.split(" ")[0]] as [string, string],
                    ),
                  ]}
                  icon={<PencilSimple size={14} />}
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <p className="text-sm font-bold text-white">Audit ledger</p>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:border-slate-500"
                >
                  <FileCsv size={14} /> Export
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {filteredLedger.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">
                    No ledger entries yet.
                  </p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-900 text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Date</th>
                        <th className="px-4 py-2 font-semibold">Member</th>
                        <th className="px-4 py-2 font-semibold">Type</th>
                        <th className="px-4 py-2 font-semibold">Description</th>
                        <th className="px-4 py-2 font-semibold text-right">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLedger.map((e) => (
                        <tr
                          key={e.id}
                          className="border-t border-slate-800/80 text-slate-300"
                        >
                          <td className="px-4 py-2 whitespace-nowrap">
                            {fmtDate(e.timestamp)}
                          </td>
                          <td className="px-4 py-2">
                            {memberById(e.memberId, members).name}
                          </td>
                          <td className="px-4 py-2">
                            <TypePill type={e.type} />
                          </td>
                          <td className="px-4 py-2 max-w-xs truncate">
                            {e.description}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {e.type === "withdrawal" || e.type === "loan-disbursed"
                              ? "−"
                              : "+"}
                            {fmtKsh(e.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function LoanRatesChairPanel({
  chama,
  members,
  onSaveLoanRates,
}: {
  chama?: Chama;
  members: Member[];
  onSaveLoanRates?: (next: {
    defaultMonthlyPercent: number;
    options: { label: string; monthlyPercent: number }[];
  }) => void | Promise<void>;
}) {
  const me = members.find((m) => m.isCurrentUser);
  const isChair = me?.role === "Chairperson";
  const [defaultRate, setDefaultRate] = useState(
    chama?.constitution?.loanInterestMonthlyPercent ?? 10,
  );
  const [options, setOptions] = useState<
    { label: string; monthlyPercent: number }[]
  >(() =>
    chama?.constitution?.loanInterestOptions?.length
      ? [...chama.constitution.loanInterestOptions]
      : [
          {
            label: "Standard",
            monthlyPercent:
              chama?.constitution?.loanInterestMonthlyPercent ?? 10,
          },
          { label: "Welfare", monthlyPercent: 5 },
        ],
  );
  const [saving, setSaving] = useState(false);

  if (!isChair || !onSaveLoanRates) {
    return null;
  }

  const addOption = () => {
    setOptions((prev) => [...prev, { label: "New rate", monthlyPercent: 10 }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaveLoanRates({
        defaultMonthlyPercent: defaultRate,
        options: options.filter((o) => o.label.trim() && o.monthlyPercent >= 0),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-white">
            Loan interest rates (Chairperson)
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Set the default monthly flat rate and optional named rates members
            can pick when proposing a loan.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500">
            Default % per month (flat on principal)
          </span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={defaultRate}
            onChange={(e) => setDefaultRate(Number(e.target.value) || 0)}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
          />
        </label>
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Rate options
        </p>
        {options.map((opt, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2">
            <input
              value={opt.label}
              onChange={(e) =>
                setOptions((prev) =>
                  prev.map((o, i) =>
                    i === idx ? { ...o, label: e.target.value } : o,
                  ),
                )
              }
              placeholder="Label e.g. Welfare"
              className="min-w-[8rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
            />
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={opt.monthlyPercent}
              onChange={(e) =>
                setOptions((prev) =>
                  prev.map((o, i) =>
                    i === idx
                      ? { ...o, monthlyPercent: Number(e.target.value) || 0 }
                      : o,
                  ),
                )
              }
              className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm font-mono text-white"
            />
            <span className="text-[11px] text-slate-500">% / month</span>
            <button
              type="button"
              onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
              className="text-[11px] font-bold text-rose-400 hover:text-rose-300"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setOptions((prev) => [
              ...prev,
              { label: "New rate", monthlyPercent: 10 },
            ])
          }
          className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300"
        >
          + Add rate option
        </button>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save rates for this chama"}
      </button>
    </div>
  );
}


function OfficialLoanSummary({
  proposal,
  memberName,
  balance,
  members,
  onRepay,
  onReschedule,
  canDisburse,
  onDisburse,
  onPartialRepay,
}: {
  proposal: Proposal;
  memberName: string;
  balance: number;
  members: Member[];
  onRepay: (id: string) => void;
  onReschedule: (
    proposalId: string,
    repayment: LoanRepaymentPlan,
    meta: { mode: "early" | "extend"; settleAmount?: number },
  ) => void;
  canDisburse: boolean;
  onDisburse: (id: string) => void | Promise<void>;
  onPartialRepay?: (
    proposalId: string,
    amount: number,
    method: string,
  ) => void | Promise<void>;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{memberName}</p>
          <p className="text-[11px] text-slate-500">
            {proposal.status} · {fmtKsh(proposal.amount)} principal · balance{" "}
            {fmtKsh(balance)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:border-slate-500"
        >
          {more ? "Hide" : "See more"}
        </button>
      </div>
      {more && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="text-[11px] text-slate-400">
            {proposal.reason || proposal.title}
          </p>
          {proposal.repayment?.schedule?.map((s, i) => (
            <div key={i} className="flex justify-between text-[11px]">
              <span className="text-slate-500">
                {s.paid ? "✓" : "○"} #{i + 1} · {fmtDate(s.dueDate)}
              </span>
              <span className="font-mono text-slate-300">{fmtKsh(s.amount)}</span>
            </div>
          ))}
          {proposal.status === "approved" && onDisburse && (
            <button
              type="button"
              disabled={!canDisburse}
              onClick={() => void onDisburse(proposal.id)}
              className={`mt-2 w-full rounded-lg py-2 text-xs font-bold ${
                canDisburse
                  ? "bg-sky-500 text-white"
                  : "cursor-not-allowed bg-slate-800 text-slate-500"
              }`}
            >
              {canDisburse ? "Disburse loan" : "Treasurer only"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MemberLoanRow({
  proposal,
  balance,
  members,
  onRepay,
  onReschedule,
  canDisburse,
  onDisburse,
  onPartialRepay,
}: {
  proposal: Proposal;
  balance: number;
  members: Member[];
  onRepay: (id: string) => void;
  onReschedule: LoansAndLedgerProps["onReschedule"];
  canDisburse: boolean;
  onDisburse: (id: string) => void | Promise<void>;
  onPartialRepay?: LoansAndLedgerProps["onPartialRepay"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div id={`loan-row-${proposal.id}`} className="py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-white">{proposal.title}</p>
          <p className="text-[11px] text-slate-500">
            {proposal.status} · balance {fmtKsh(balance)}
          </p>
        </div>
        <span className="text-[11px] font-bold text-emerald-400">
          {open ? "Close" : "View"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {(proposal.status === "disbursed" || proposal.status === "approved") &&
            balance > 0 &&
            onPartialRepay && (
              <RepayPanel
                proposalId={proposal.id}
                fullBalance={balance}
                onPartialRepay={onPartialRepay}
              />
            )}
          <LoanCard
            proposal={proposal}
            members={members}
            defaultOpen
            onRepay={onRepay}
            onReschedule={onReschedule}
            canDisburse={canDisburse}
            onDisburse={onDisburse}
          />
        </div>
      )}
    </div>
  );
}

function RepayPanel({
  proposalId,
  fullBalance,
  onPartialRepay,
}: {
  proposalId: string;
  fullBalance: number;
  onPartialRepay: (
    proposalId: string,
    amount: number,
    method: string,
  ) => void | Promise<void>;
}) {
  const [amount, setAmount] = useState(fullBalance);
  const [method, setMethod] = useState<string>(PAY_METHODS[0].id);
  const [busy, setBusy] = useState(false);
  const remaining = Math.max(0, Math.round((fullBalance - amount) * 100) / 100);

  const submit = async () => {
    if (amount <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    if (amount > fullBalance + 0.01) {
      toast.error("Amount cannot exceed loan balance");
      return;
    }
    setBusy(true);
    try {
      await onPartialRepay(proposalId, amount, method);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="text-xs font-bold text-emerald-300">Repay loan</p>
      <p className="mt-1 text-[11px] text-slate-400">
        Full balance{" "}
        <span className="font-mono text-white">{fmtKsh(fullBalance)}</span> — edit
        what you pay now
      </p>
      <label className="mt-2 block text-[10px] font-semibold uppercase text-slate-500">
        Amount (KES)
      </label>
      <input
        type="number"
        min={1}
        max={fullBalance}
        step={100}
        value={amount}
        onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
        className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm font-bold text-white"
      />
      <p className="mt-1 text-[11px] text-slate-500">
        After payment, balance will be{" "}
        <span className="font-mono font-semibold text-amber-300">
          {fmtKsh(remaining)}
        </span>
      </p>
      <label className="mt-2 block text-[10px] font-semibold uppercase text-slate-500">
        Pay via
      </label>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
      >
        {PAY_METHODS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[10px] text-slate-600">
        Payment APIs will connect here later — method is recorded now.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-3 w-full rounded-lg bg-emerald-500 py-2.5 text-xs font-bold text-white hover:bg-emerald-400 disabled:opacity-60"
      >
        {busy ? "Processing…" : `Pay ${fmtKsh(amount)}`}
      </button>
    </div>
  );
}


function ensurePlan(proposal: Proposal): LoanRepaymentPlan {
  if (proposal.repayment?.schedule?.length) return proposal.repayment;
  const months = 3;
  const monthlyInterest = proposal.amount * 0.1;
  const totalInterest = monthlyInterest * months;
  const totalRepay = proposal.amount + totalInterest;
  const installment = totalRepay / months;
  const start = new Date();
  return {
    interestRate: 10,
    interestModel: "flat",
    installments: months,
    schedule: Array.from({ length: months }, (_, i) => {
      const due = new Date(start);
      due.setMonth(due.getMonth() + i + 1);
      return {
        dueDate: due.toISOString().slice(0, 10),
        amount: Math.round(installment * 100) / 100,
        paid: false,
      };
    }),
  };
}

function LoanCard({
  proposal,
  members,
  defaultOpen,
  onRepay,
  onReschedule,
  canDisburse,
  onDisburse,
}: {
  proposal: Proposal;
  members: Member[];
  defaultOpen: boolean;
  onRepay: (id: string) => void;
  onReschedule: (
    proposalId: string,
    repayment: LoanRepaymentPlan,
    meta: { mode: "early" | "extend"; settleAmount?: number },
  ) => void;
  canDisburse: boolean;
  onDisburse: (proposalId: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const requester = memberById(proposal.requesterId, members);
  const plan = ensurePlan(proposal);
  const paidCount = plan.schedule.filter((s) => s.paid).length;
  const totalInstallments = plan.schedule.length;
  const unpaidCount = totalInstallments - paidCount;
  const remaining = plan.schedule
    .filter((s) => !s.paid)
    .reduce((a, s) => a + s.amount, 0);

  const statusChip =
    proposal.status === "approved"
      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
      : proposal.status === "disbursed"
        ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
        : proposal.status === "settled"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-slate-600 bg-slate-800/60 text-slate-300";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusChip}`}
          >
            {proposal.status}
          </span>
          <h3 className="mt-2 text-sm font-bold text-white">{proposal.title}</h3>
          {proposal.reason && (
            <p className="mt-1 text-[11px] text-slate-500">{proposal.reason}</p>
          )}
        </div>
        <span className="font-mono text-lg font-bold text-emerald-300">
          {fmtKsh(proposal.amount)}
        </span>
      </div>

      <div className="mt-3 text-xs text-slate-400">
        {requester.name}
        {proposal.disbursedAt && (
          <span> · Disbursed {fmtDate(proposal.disbursedAt)}</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">
          Repayment {paidCount}/{totalInstallments}
        </span>
        <span className="font-mono font-bold text-slate-300">
          {fmtKsh(remaining)} left · {plan.interestRate}% / mo
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
          style={{
            width: `${totalInstallments ? (paidCount / totalInstallments) * 100 : 0}%`,
          }}
        />
      </div>

      {proposal.status === "approved" && onDisburse && (
        <button
          type="button"
          disabled={!canDisburse}
          onClick={() => void onDisburse(proposal.id)}
          className={`mt-3 w-full rounded-xl py-2.5 text-xs font-bold ${
            canDisburse
              ? "bg-sky-500 text-white"
              : "cursor-not-allowed bg-slate-800 text-slate-500"
          }`}
        >
          {canDisburse ? "Disburse loan" : "Treasurer only"}
        </button>
      )}

      <div className="mt-3 space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        {plan.schedule.map((s, i) => (
          <div
            key={`${s.dueDate}-${i}`}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-slate-400">
              {s.paid ? "✓" : "○"} #{i + 1} · {fmtDate(s.dueDate)}
            </span>
            <span
              className={`font-mono font-bold ${s.paid ? "text-emerald-400" : "text-slate-300"}`}
            >
              {fmtKsh(s.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl border border-slate-700 bg-slate-950/80 py-2 pl-8 pr-8 text-xs font-semibold text-slate-200 outline-none focus:border-emerald-500/60"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TypePill({ type }: { type: AuditType }) {
  const styles: Record<string, string> = {
    contribution: "bg-emerald-500/10 text-emerald-300",
    "loan-disbursed": "bg-sky-500/10 text-sky-300",
    repayment: "bg-teal-500/10 text-teal-300",
    withdrawal: "bg-amber-500/10 text-amber-300",
    vote: "bg-violet-500/10 text-violet-300",
    penalty: "bg-rose-500/10 text-rose-300",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${styles[type] ?? "bg-slate-800 text-slate-400"}`}
    >
      {type}
    </span>
  );
}
