import { type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "framer-motion";

type AppModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Hint only — width still follows content within these bounds */
  size?: "sm" | "md" | "lg" | "auto";
};

export default function AppModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "auto",
}: AppModalProps) {
  // Soft caps: content defines actual width/height; we only limit extremes
  const widthCap =
    size === "sm"
      ? "max-w-[min(92vw,24rem)]"
      : size === "md"
        ? "max-w-[min(92vw,32rem)]"
        : size === "lg"
          ? "max-w-[min(96vw,42rem)]"
          : "max-w-[min(96vw,40rem)]";

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
          <motion.button
            type="button"
            aria-label="Close backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className={`relative z-10 flex max-h-[min(90vh,40rem)] w-auto min-w-[min(92vw,18rem)] ${widthCap} flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/50`}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-white">{title}</h2>
                {subtitle ? (
                  <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            {/* Height grows with content; scrolls only when taller than viewport */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4">
              {children}
            </div>
            {footer ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-950/40 px-4 py-3 sm:px-5">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export function ModalField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-300">{hint}</span> : null}
    </label>
  );
}

export const modalInputClass =
  "w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20";

export const modalPrimaryBtn =
  "rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50";

export const modalGhostBtn =
  "rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-white";
