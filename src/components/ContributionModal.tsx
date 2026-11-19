import { useEffect, useState } from "react";
import {
  Bank,
  CheckCircle,
  DeviceMobile,
  Money,
  Receipt,
  X,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  CHAMA_ACTIVITIES,
  type Chama,
  type ChamaActivity,
  type Contribution,
  type ContributionMethod,
  type Member,
} from "../types/chama";
import { potOptionsForChama } from "@/lib/kitVisibility";
import { fmtKsh } from "../data/mockChamaData";
import { pollContributionStatus } from "@/lib/paymentStatus";

interface ContributionModalProps {
  open: boolean;
  onClose: () => void;
  chama: Chama;
  currentMember: Member;
  onSubmit: (contribution: Contribution) => Promise<{ id?: string; channel?: string; stkConfigured?: boolean } | void>;
  lockedDestination?: string | null;
  paymentMode?: string | null;
  payToLabel?: string | null;
  /** Prefill amount (e.g. from "you owe") */
  prefillAmount?: number | null;
  prefillNote?: string | null;
  /** Shown under title e.g. Loan repayment */
  purposeLabel?: string | null;
  /** Hide kit picker (loan repay / obligation) */
  hideDestination?: boolean;
}

type Step = "channel" | "details" | "confirm" | "processing" | "stk-wait" | "success" | "failed" | "receipt";
type Channel = "manual" | "mpesa";

const MANUAL_METHODS: { value: ContributionMethod; label: string; hint: string }[] = [
  { value: "Cash", label: "Cash", hint: "Handed to treasurer or collector" },
  { value: "Airtel Money", label: "Airtel Money", hint: "Sent to designated number" },
  { value: "Bank Transfer", label: "Bank transfer", hint: "EFT / deposit to chama account" },
  { value: "Other", label: "Other", hint: "Any other rail — note in details" },
];

export default function ContributionModal({
  open,
  onClose,
  chama,
  currentMember,
  onSubmit,
  lockedDestination = null,
  paymentMode = null,
  payToLabel = null,
  prefillAmount = null,
  prefillNote = null,
  purposeLabel = null,
  hideDestination = false,
}: ContributionModalProps) {
  const effectiveMode =
    paymentMode || chama.constitution?.paymentMode || null;
  const payTo = payToLabel || chama.constitution?.payToLabel || null;

  const [step, setStep] = useState<Step>("channel");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [method, setMethod] = useState<ContributionMethod>("Cash");
  const [destination, setDestination] = useState<ChamaActivity>(
    (lockedDestination as ChamaActivity) ||
      potOptionsForChama(chama).map(a => a.value)?.[0] ||
      "general-savings",
  );
  const [phone, setPhone] = useState(currentMember.phone || "");
  const [amount, setAmount] = useState(
    prefillAmount || chama.constitution.minMonthlyContribution,
  );
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [paymentDetails, setPaymentDetails] = useState("");
  const [savedRef, setSavedRef] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("channel");
    setChannel(null);
    setDestination(
      (lockedDestination as ChamaActivity) ||
        potOptionsForChama(chama).map(a => a.value)?.[0] ||
        "general-savings",
    );
    setPhone(currentMember.phone || "");
    setAmount(
      prefillAmount && prefillAmount > 0
        ? prefillAmount
        : chama.constitution.minMonthlyContribution,
    );
    setReference("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentDetails("");
    setSavedRef("");
    // If chama forces one mode, skip channel pick
    if (effectiveMode === "mpesa_stk") {
      setChannel("mpesa");
      setMethod("M-Pesa STK Push");
      setStep("details");
    } else if (effectiveMode === "manual_confirm") {
      setChannel("manual");
      setMethod("Cash");
      setStep("details");
    }
  }, [
    open,
    lockedDestination,
    prefillAmount,
    effectiveMode,
    currentMember.phone,
    chama.constitution.minMonthlyContribution,
    chama.constitution?.enabledKitCodes,
    chama.constitution?.activities,
  ]);

  const genReference = () =>
    `CV${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;

  const potOptions = potOptionsForChama(chama);

  const canSubmit = () => {
    if (amount < 100) return false;
    if (channel === "mpesa") return phone.replace(/\D/g, "").length >= 9;
    if (channel === "manual") {
      if (!reference.trim() && !paymentDetails.trim()) return false;
      return true;
    }
    return false;
  };

  const handleConfirmPay = () => {
    const ref =
      channel === "mpesa"
        ? genReference()
        : reference.trim() || genReference();
    setSavedRef(ref);
    setStep("processing");
    const payload: Contribution = {
      id: `c-${Date.now()}`,
      memberId: currentMember.id,
      chamaId: chama.id,
      amount,
      method:
        channel === "mpesa" ? "M-Pesa STK Push" : method,
      destination,
      paymentDetails:
        channel === "mpesa" ? phone : paymentDetails || reference,
      reference: ref,
      status: "pending",
      date: `${paymentDate}T12:00:00.000Z`,
    };
    void onSubmit(payload)
      .then(async (result) => {
        if (channel === "mpesa" && result?.id) {
          setStep("stk-wait");
          const status = await pollContributionStatus(result.id, {
            intervalMs: 2500,
            timeoutMs: 100_000,
          });
          if (status === "completed") {
            setStep("success");
            toast.success("Payment received — pots updated");
          } else {
            setStep("failed");
          }
          return;
        }
        // Manual → waiting treasurer
        setStep("receipt");
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Payment could not be submitted",
        );
        setStep("failed");
      });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-auto min-w-[min(92vw,18rem)] max-w-[min(92vw,28rem)] max-h-[min(90vh,40rem)] overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Receipt size={19} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">
                    {purposeLabel || "Make a payment"}
                  </h2>
                  <p className="text-[11px] text-slate-400">{chama.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5">
              {!effectiveMode && (
                <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Leaders must set how this chama receives money first (
                  <strong>Chama Finance → How members pay</strong>).
                </div>
              )}

              {prefillNote && (
                <p className="mb-3 rounded-lg bg-slate-800/80 px-3 py-2 text-xs text-slate-300">
                  {prefillNote}
                </p>
              )}

              {/* Step: channel */}
              {step === "channel" && effectiveMode && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-white">
                    How do you want to pay?
                  </p>
                  <p className="text-xs text-slate-400">
                    Nothing updates the pots until payment is confirmed the right way.
                  </p>
                  {(effectiveMode === "manual_confirm" ||
                    effectiveMode === "both") && (
                    <button
                      type="button"
                      onClick={() => {
                        setChannel("manual");
                        setMethod("Cash");
                        setStep("details");
                      }}
                      className="flex w-full items-start gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left hover:border-emerald-500/50"
                    >
                      <Money size={28} className="shrink-0 text-emerald-400" />
                      <div>
                        <p className="font-bold text-white">Manual payment</p>
                        <p className="mt-1 text-xs text-slate-400">
                          You already paid (or will pay) cash, Airtel, or bank to the
                          chama account. Enter details; treasurer confirms.
                        </p>
                        {payTo && (
                          <p className="mt-2 text-xs font-semibold text-emerald-300">
                            Pay to: {payTo}
                          </p>
                        )}
                      </div>
                    </button>
                  )}
                  {(effectiveMode === "mpesa_stk" || effectiveMode === "both") && (
                    <button
                      type="button"
                      onClick={() => {
                        setChannel("mpesa");
                        setMethod("M-Pesa STK Push");
                        setStep("details");
                      }}
                      className="flex w-full items-start gap-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left hover:border-sky-500/50"
                    >
                      <DeviceMobile size={28} className="shrink-0 text-sky-400" />
                      <div>
                        <p className="font-bold text-white">M-Pesa STK Push</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Enter phone → PIN on your phone → money hits the till; pot
                          updates when M-Pesa confirms.
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              )}

              {/* Details */}
              {step === "details" && channel && (
                <div className="space-y-4">
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-400 hover:text-white"
                    onClick={() =>
                      effectiveMode === "both"
                        ? setStep("channel")
                        : onClose()
                    }
                  >
                    ← Back
                  </button>

                  {channel === "manual" && payTo && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                      Pay to: <strong>{payTo}</strong>
                    </div>
                  )}

                  {channel === "manual" && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Means of payment
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {MANUAL_METHODS.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setMethod(m.value)}
                            className={`rounded-xl border px-3 py-2.5 text-left text-xs ${
                              method === m.value
                                ? "border-emerald-500/50 bg-emerald-500/15 text-white"
                                : "border-slate-700 text-slate-300"
                            }`}
                          >
                            <span className="font-bold">{m.label}</span>
                            <span className="mt-0.5 block text-[10px] text-slate-500">
                              {m.hint}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {!hideDestination && (
                    <label className="block text-xs font-semibold uppercase text-slate-400">
                      Pot / account
                      <select
                        value={destination}
                        disabled={!!lockedDestination}
                        onChange={(e) =>
                          setDestination(e.target.value as ChamaActivity)
                        }
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white disabled:opacity-70"
                      >
                        {(potOptions.length
                          ? potOptions
                          : CHAMA_ACTIVITIES
                        ).map((a) => (
                          <option key={a.value} value={a.value}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {hideDestination && purposeLabel && (
                    <p className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                      {purposeLabel}
                      {prefillAmount && prefillAmount > 0
                        ? ` · ${fmtKsh(prefillAmount)}`
                        : ""}
                    </p>
                  )}

                  <label className="block text-xs font-semibold uppercase text-slate-400">
                    Amount (KES)
                    <input
                      type="number"
                      min={100}
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value) || 0)}
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white"
                    />
                  </label>

                  {channel === "mpesa" ? (
                    <label className="block text-xs font-semibold uppercase text-slate-400">
                      M-Pesa phone (receives PIN prompt)
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="07xxxxxxxx"
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
                      />
                    </label>
                  ) : (
                    <>
                      <label className="block text-xs font-semibold uppercase text-slate-400">
                        Reference / receipt no.
                        <input
                          type="text"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder="e.g. M-Pesa code or receipt"
                          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
                        />
                      </label>
                      <label className="block text-xs font-semibold uppercase text-slate-400">
                        Date paid
                        <input
                          type="date"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
                        />
                      </label>
                      <label className="block text-xs font-semibold uppercase text-slate-400">
                        Notes (optional)
                        <input
                          type="text"
                          value={paymentDetails}
                          onChange={(e) => setPaymentDetails(e.target.value)}
                          placeholder="Who received cash, bank name…"
                          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
                        />
                      </label>
                    </>
                  )}

                  <button
                    type="button"
                    disabled={!canSubmit() || !effectiveMode}
                    onClick={() => setStep("confirm")}
                    className="w-full rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Continue
                  </button>
                </div>
              )}

              {step === "confirm" && (
                <div className="space-y-4">
                  <p className="text-sm font-bold text-white">Confirm payment</p>
                  <ul className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
                    <li className="flex justify-between">
                      <span className="text-slate-500">Channel</span>
                      <span className="text-white">
                        {channel === "mpesa" ? "M-Pesa STK" : `Manual · ${method}`}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-slate-500">Pot</span>
                      <span className="text-white">
                        {CHAMA_ACTIVITIES.find((a) => a.value === destination)
                          ?.label || destination}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-slate-500">Amount</span>
                      <span className="font-mono font-bold text-emerald-300">
                        {fmtKsh(amount)}
                      </span>
                    </li>
                    {channel === "manual" && (
                      <>
                        <li className="flex justify-between gap-2">
                          <span className="text-slate-500">Reference</span>
                          <span className="text-right text-white">
                            {reference || "(auto)"}
                          </span>
                        </li>
                        <li className="flex justify-between">
                          <span className="text-slate-500">Date</span>
                          <span className="text-white">{paymentDate}</span>
                        </li>
                      </>
                    )}
                    {channel === "mpesa" && (
                      <li className="flex justify-between">
                        <span className="text-slate-500">Phone</span>
                        <span className="text-white">{phone}</span>
                      </li>
                    )}
                  </ul>
                  <p className="text-[11px] text-slate-500">
                    {channel === "manual"
                      ? "Treasurer must approve before this amount is added to the pot."
                      : "Complete the M-Pesa PIN prompt on your phone."}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStep("details")}
                      className="flex-1 rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-300"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmPay}
                      className="flex-1 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
                    >
                      Submit payment
                    </button>
                  </div>
                </div>
              )}

              {step === "processing" && (
                <div className="py-10 text-center">
                  <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                  <p className="mt-4 text-sm font-semibold text-white">
                    Submitting…
                  </p>
                </div>
              )}

              {step === "stk-wait" && (
                <div className="space-y-4 py-8 text-center">
                  <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                  <p className="text-lg font-bold text-white">Waiting for M-Pesa</p>
                  <p className="text-sm text-slate-400">
                    Enter your PIN on the phone prompt. We will update the pot as soon as
                    Safaricom confirms.
                  </p>
                  <p className="font-mono text-xs text-slate-500">Ref {savedRef}</p>
                </div>
              )}

              {step === "success" && (
                <div className="space-y-4 py-4 text-center">
                  <CheckCircle
                    size={52}
                    className="mx-auto text-emerald-400"
                    weight="fill"
                  />
                  <p className="text-lg font-bold text-white">Payment successful</p>
                  <p className="text-sm text-slate-400">
                    {fmtKsh(amount)} has been received. Your pot and the group pool are
                    updated. No treasurer approval needed for M-Pesa.
                  </p>
                  <p className="font-mono text-xs text-slate-500">Ref {savedRef}</p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      window.location.reload();
                    }}
                    className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
                  >
                    Done
                  </button>
                </div>
              )}

              {step === "failed" && (
                <div className="space-y-4 py-4 text-center">
                  <p className="text-4xl">!</p>
                  <p className="text-lg font-bold text-rose-300">Payment failed</p>
                  <p className="text-sm text-slate-400">
                    M-Pesa did not complete (cancelled, timeout, or error). Nothing was
                    added to the pots. Try again or use manual payment.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setChannel("mpesa");
                        setStep("details");
                      }}
                      className="w-full rounded-xl bg-sky-500 py-3 text-sm font-bold text-white"
                    >
                      Try M-Pesa again
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChannel("manual");
                        setMethod("Cash");
                        setStep("details");
                      }}
                      className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-3 text-sm font-bold text-emerald-200"
                    >
                      Use manual payment
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="w-full rounded-xl border border-slate-600 py-3 text-sm font-semibold text-slate-300"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              {step === "receipt" && (
                <div className="space-y-4 py-4 text-center">
                  <CheckCircle
                    size={48}
                    className="mx-auto text-emerald-400"
                    weight="fill"
                  />
                  <p className="text-lg font-bold text-white">Waiting for treasurer</p>
                  <p className="text-sm text-slate-400">
                    Your payment is registered. The treasurer will approve when money is
                    received — then pots update.
                  </p>
                  <p className="font-mono text-xs text-slate-500">Ref {savedRef}</p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white"
                  >
                    Done
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
