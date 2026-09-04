import { useEffect, useState } from "react";
import {
  Bank,
  CaretDown,
  CheckCircle,
  Clock,
  Phone,
  Plus,
  Receipt,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import type { Chama, Contribution, ContributionMethod, Member } from "../types/chama";
import { fmtKsh } from "../data/mockChamaData";

interface ContributionModalProps {
  open: boolean;
  onClose: () => void;
  chama: Chama;
  currentMember: Member;
  onSubmit: (contribution: Contribution) => void;
}

type Step = "method" | "pay" | "processing" | "receipt";

export default function ContributionModal({
  open,
  onClose,
  chama,
  currentMember,
  onSubmit,
}: ContributionModalProps) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<ContributionMethod>("M-Pesa STK Push");
  const [phone, setPhone] = useState(currentMember.phone);
  const [amount, setAmount] = useState(chama.constitution.minMonthlyContribution);
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (open) {
      setStep("method");
      setMethod("M-Pesa STK Push");
      setPhone(currentMember.phone);
      setAmount(chama.constitution.minMonthlyContribution);
      setReference("");
    }
  }, [open, currentMember.phone, chama.constitution.minMonthlyContribution]);

  const quickAmounts = [
    chama.constitution.minMonthlyContribution,
    chama.constitution.minMonthlyContribution * 2,
    chama.constitution.minMonthlyContribution * 3,
  ];

  const genReference = () =>
    `CV${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;

  const handlePay = () => {
    const ref = genReference();
    setReference(ref);
    setStep("processing");
    window.setTimeout(() => {
      onSubmit({
        id: `c-${Date.now()}`,
        memberId: currentMember.id,
        chamaId: chama.id,
        amount,
        method,
        reference: ref,
        status: "completed",
        date: new Date().toISOString(),
      });
      toast.success("Contribution confirmed — funds settled to group account", {
        description: `${method} · ${fmtKsh(amount)} · Ref ${ref}`,
        icon: <CheckCircle className="text-emerald-400" />,
      });
      setStep("receipt");
    }, 1800);
  };

  const stkDigits = phone.replace(/\D/g, "").slice(-9);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-t-3xl border border-slate-700/70 bg-slate-900 shadow-2xl shadow-black/60 sm:rounded-3xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Receipt size={19} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Cashless Contribution</h2>
                  <p className="text-[11px] text-slate-400">{chama.name}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              {step === "method" && (
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed text-slate-400">
                    Money moves straight to the group's bank/M-Pesa paybill —{" "}
                    <span className="font-semibold text-emerald-300">
                      no member or treasurer ever touches cash
                    </span>
                    . Choose your rail:
                  </p>
                  <div className="grid gap-2.5">
                    {(
                      [
                        {
                          id: "M-Pesa STK Push" as ContributionMethod,
                          icon: <Phone size={20} weight="bold" className="text-emerald-400" />,
                          name: "M-Pesa STK Push",
                          desc: "Prompt sent to your phone · instant settlement",
                          tag: "Fastest",
                          accent: "border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15",
                        },
                        {
                          id: "Bank EFT / RTGS" as ContributionMethod,
                          icon: <Bank size={20} weight="bold" className="text-sky-400" />,
                          name: "Bank EFT / RTGS",
                          desc: "Direct transfer to group business account",
                          tag: "Large sums",
                          accent: "border-sky-500/50 bg-sky-500/10 hover:bg-sky-500/15",
                        },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setMethod(m.id);
                          setStep("pay");
                        }}
                        className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition active:scale-[0.99] ${m.accent}`}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950/50">
                          {m.icon}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-white">{m.name}</p>
                          <p className="text-xs text-slate-400">{m.desc}</p>
                        </div>
                        <span className="rounded-full bg-slate-950/60 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                          {m.tag}
                        </span>
                        <CaretDown size={16} className="-rotate-90 text-slate-500" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === "pay" && (
                <div className="space-y-4">
                  {/* Amount selector */}
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Amount (KES)
                    </label>
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3">
                      <span className="font-mono text-sm font-bold text-emerald-400">KES</span>
                      <input
                        type="number"
                        min={100}
                        value={amount}
                        onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-transparent font-mono text-lg font-bold tabular-nums text-white outline-none"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {quickAmounts.map((q) => (
                        <button
                          key={q}
                          onClick={() => setAmount(q)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                            amount === q
                              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                              : "border-slate-700 text-slate-400 hover:border-slate-500"
                          }`}
                        >
                          {fmtKsh(q)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Phone (STK only) */}
                  {method === "M-Pesa STK Push" ? (
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                        <Phone size={12} /> M-Pesa number
                      </label>
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none focus:border-emerald-500/60"
                        placeholder="+254 7XX XXX XXX"
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-3.5 text-xs text-slate-300">
                      <p className="font-semibold text-sky-300">Group business account</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        Equity Bank · ChamaVault Trustees Ltd · Acc 0298-5561-2204
                      </p>
                    </div>
                  )}

                  <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[11px] leading-relaxed text-slate-500">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                    State your phone number and approve the STK popup. Funds credit the{" "}
                    {method === "M-Pesa STK Push" ? "paybill 247247 · ChamaVault" : "group business account"}{" "}
                    instantly and hit the ledger — nobody handles cash.
                  </div>

                  <button
                    onClick={handlePay}
                    disabled={amount < 100}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {method === "M-Pesa STK Push" ? (
                      <>
                        <Phone size={17} weight="fill" /> Push STK to {stkDigits}
                      </>
                    ) : (
                      <>
                        <Bank size={17} weight="fill" /> Confirm EFT of {fmtKsh(amount)}
                      </>
                    )}
                  </button>
                </div>
              )}

              {step === "processing" && (
                <div className="flex flex-col items-center py-10 text-center">
                  <div className="relative">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                      className="h-16 w-16 rounded-full border-4 border-slate-800 border-t-emerald-400"
                    />
                    <Clock size={22} className="absolute inset-0 m-auto text-emerald-400" />
                  </div>
                  <h3 className="mt-5 text-sm font-bold text-white">Processing {method}...</h3>
                  <p className="mt-1 font-mono text-xs text-slate-500">{fmtKsh(amount)} · Ref {reference}</p>
                  <p className="mt-3 max-w-[260px] text-[11px] leading-relaxed text-slate-500">
                    {method === "M-Pesa STK Push"
                      ? "Simulating the STK push, PIN entry and instant webhook confirmation to the group paybill..."
                      : "Simulating the EFT/RTGS transfer and bank webhook confirmation..."}
                  </p>
                </div>
              )}

              {step === "receipt" && (
                <div className="space-y-4">
                  <div className="flex flex-col items-center pt-2 text-center">
                    <motion.div
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 14 }}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"
                    >
                      <CheckCircle size={30} weight="fill" />
                    </motion.div>
                    <h3 className="mt-3 text-base font-bold text-white">Contribution settled</h3>
                    <p className="text-xs text-slate-400">
                      Credited to the group account — zero cash handled
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60">
                    <div className="flex items-center justify-between border-b border-dashed border-slate-800 px-4 py-2.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Digital receipt
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                        <ShieldCheck size={11} /> Verified
                      </span>
                    </div>
                    <div className="space-y-2 px-4 py-3.5 text-[11px]">
                      {[
                        ["Member", currentMember.name],
                        ["Amount", fmtKsh(amount)],
                        ["Rail", method],
                        ["Reference", reference],
                        ["Date", new Date().toLocaleString("en-US")],
                        ["Status", "Completed"],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-slate-500">{k}</span>
                          <span className="font-medium text-slate-200">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-slate-800 bg-slate-900/50 px-4 py-2 font-mono text-[10px] text-slate-600">
                      RAFIKI-{reference} •{" "}
                      {method === "M-Pesa STK Push" ? "MPESA" : "SWIFT-ish EFT"} • TRANSACTION LOGGED
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-sm font-bold text-white transition hover:from-emerald-400 hover:to-teal-500"
                  >
                    <Plus size={16} weight="bold" className="rotate-45" /> Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}