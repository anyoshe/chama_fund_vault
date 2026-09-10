import { useEffect, useState } from "react";
import AppModal, {
  ModalField,
  modalGhostBtn,
  modalInputClass,
  modalPrimaryBtn,
} from "./AppModal";
import { fmtKsh } from "@/data/mockChamaData";

type LoanRequestModalProps = {
  open: boolean;
  onClose: () => void;
  maxAmount: number;
  defaultRate: number;
  rateOptions?: { label: string; monthlyPercent: number }[];
  onSubmit: (data: {
    amount: number;
    termMonths: number;
    rate: number;
  }) => void | Promise<void>;
};

export function LoanRequestModal({
  open,
  onClose,
  maxAmount,
  defaultRate,
  rateOptions,
  onSubmit,
}: LoanRequestModalProps) {
  const [amount, setAmount] = useState("");
  const [termMonths, setTermMonths] = useState("3");
  const [rate, setRate] = useState(String(defaultRate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount("");
      setTermMonths("3");
      setRate(String(defaultRate));
      setError(null);
      setBusy(false);
    }
  }, [open, defaultRate]);

  const submit = async () => {
    const a = Number(amount);
    const t = Math.floor(Number(termMonths));
    const r = Number(rate);
    if (!a || a <= 0) {
      setError("Enter a valid loan amount");
      return;
    }
    if (a > maxAmount + 0.01) {
      setError(`Maximum you can borrow is ${fmtKsh(maxAmount)}`);
      return;
    }
    if (!t || t < 1) {
      setError("Term must be at least 1 month");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ amount: a, termMonths: t, rate: r || defaultRate });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Request a loan"
      subtitle={`Borrow up to ${fmtKsh(maxAmount)} from the loaning pool`}
      footer={
        <>
          <button type="button" className={modalGhostBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={modalPrimaryBtn}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Submitting…" : "Submit for quorum vote"}
          </button>
        </>
      }
    >
      <ModalField label="Amount (KES)">
        <input
          className={modalInputClass}
          inputMode="decimal"
          placeholder="e.g. 10000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </ModalField>
      <ModalField label="Repayment term (months)">
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 6, 12].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTermMonths(String(n))}
              className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                termMonths === String(n)
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {n} mo
            </button>
          ))}
        </div>
        <input
          className={`${modalInputClass} mt-2`}
          inputMode="numeric"
          value={termMonths}
          onChange={(e) => setTermMonths(e.target.value)}
        />
      </ModalField>
      <ModalField label="Interest rate (% per month flat on principal)">
        {rateOptions && rateOptions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {rateOptions.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setRate(String(o.monthlyPercent))}
                className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                  Number(rate) === o.monthlyPercent
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                    : "border-slate-700 text-slate-400"
                }`}
              >
                {o.label} · {o.monthlyPercent}%
              </button>
            ))}
          </div>
        ) : null}
        <input
          className={modalInputClass}
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
      </ModalField>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </AppModal>
  );
}

type DisburseModalProps = {
  open: boolean;
  onClose: () => void;
  applicantName: string;
  amount: number;
  onSubmit: (data: {
    method: "mobile-money" | "bank-transfer";
    destination: string;
    transferReference: string;
  }) => void | Promise<void>;
};

export function DisburseModal({
  open,
  onClose,
  applicantName,
  amount,
  onSubmit,
}: DisburseModalProps) {
  const [method, setMethod] = useState<"mobile-money" | "bank-transfer">(
    "mobile-money",
  );
  const [destination, setDestination] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMethod("mobile-money");
      setDestination("");
      setTransferReference("");
      setConfirmed(false);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!confirmed) {
      setError("Confirm the applicant is correct");
      return;
    }
    if (!destination.trim()) {
      setError("Enter phone or account destination");
      return;
    }
    if (!transferReference.trim()) {
      setError("Enter transfer / M-Pesa reference");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        method,
        destination: destination.trim(),
        transferReference: transferReference.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disburse failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="Disburse approved loan"
      subtitle={`${fmtKsh(amount)} → ${applicantName}`}
      footer={
        <>
          <button type="button" className={modalGhostBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={modalPrimaryBtn}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Disbursing…" : "Confirm disbursement"}
          </button>
        </>
      }
    >
      <label className="mb-4 flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="text-sm text-slate-300">
          I confirm <strong className="text-white">{applicantName}</strong> is
          the rightful applicant for this facility.
        </span>
      </label>
      <ModalField label="Payment rail">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["mobile-money", "Mobile money"],
              ["bank-transfer", "Bank transfer"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              className={`rounded-xl border px-3 py-3 text-xs font-bold ${
                method === id
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </ModalField>
      <ModalField
        label={method === "mobile-money" ? "M-Pesa / phone number" : "Bank account"}
      >
        <input
          className={modalInputClass}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={
            method === "mobile-money" ? "+254 7XX XXX XXX" : "Account number"
          }
        />
      </ModalField>
      <ModalField label="Transfer reference">
        <input
          className={modalInputClass}
          value={transferReference}
          onChange={(e) => setTransferReference(e.target.value)}
          placeholder="M-Pesa code / bank ref"
        />
      </ModalField>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </AppModal>
  );
}

type SimpleFieldsModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fields: {
    key: string;
    label: string;
    placeholder?: string;
    defaultValue?: string;
    type?: "text" | "number";
    required?: boolean;
  }[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
};

export function SimpleFieldsModal({
  open,
  onClose,
  title,
  subtitle,
  fields,
  submitLabel = "Confirm",
  onSubmit,
}: SimpleFieldsModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const init: Record<string, string> = {};
      for (const f of fields) init[f.key] = f.defaultValue ?? "";
      setValues(init);
      setBusy(false);
      setError(null);
    }
  }, [open, fields]);

  const submit = async () => {
    for (const f of fields) {
      if (f.required && !String(values[f.key] ?? "").trim()) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit(values);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        <>
          <button type="button" className={modalGhostBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={modalPrimaryBtn}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Working…" : submitLabel}
          </button>
        </>
      }
    >
      {fields.map((f) => (
        <ModalField key={f.key} label={f.label}>
          <input
            className={modalInputClass}
            type={f.type === "number" ? "text" : "text"}
            inputMode={f.type === "number" ? "decimal" : "text"}
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) =>
              setValues((v) => ({ ...v, [f.key]: e.target.value }))
            }
          />
        </ModalField>
      ))}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
    </AppModal>
  );
}

type ChoiceModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: { id: string; label: string; description?: string }[];
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (id: string, approve?: boolean) => void | Promise<void>;
  showApproveReject?: boolean;
};

export function ChoiceModal({
  open,
  onClose,
  title,
  subtitle,
  options,
  confirmLabel = "Continue",
  onConfirm,
  showApproveReject,
}: ChoiceModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(options[0]?.id ?? null);
      setBusy(false);
    }
  }, [open, options]);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={
        showApproveReject ? (
          <>
            <button
              type="button"
              className={modalGhostBtn}
              disabled={busy || !selected}
              onClick={() => {
                if (!selected) return;
                setBusy(true);
                void onConfirm(selected, false).finally(() => {
                  setBusy(false);
                  onClose();
                });
              }}
            >
              Reject
            </button>
            <button
              type="button"
              className={modalPrimaryBtn}
              disabled={busy || !selected}
              onClick={() => {
                if (!selected) return;
                setBusy(true);
                void onConfirm(selected, true).finally(() => {
                  setBusy(false);
                  onClose();
                });
              }}
            >
              Approve & pay
            </button>
          </>
        ) : (
          <>
            <button type="button" className={modalGhostBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={modalPrimaryBtn}
              disabled={busy || !selected}
              onClick={() => {
                if (!selected) return;
                setBusy(true);
                void onConfirm(selected).finally(() => {
                  setBusy(false);
                  onClose();
                });
              }}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </>
        )
      }
    >
      <div className="space-y-2">
        {options.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing to select.</p>
        ) : (
          options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelected(o.id)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                selected === o.id
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
              }`}
            >
              <p className="text-sm font-semibold text-white">{o.label}</p>
              {o.description ? (
                <p className="mt-0.5 text-[11px] text-slate-400">{o.description}</p>
              ) : null}
            </button>
          ))
        )}
      </div>
    </AppModal>
  );
}
