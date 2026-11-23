import { type ReactNode, useEffect } from "react";
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

/**
 * Centred modal on all viewports. Scrolls inside when content is tall.
 * Uses dvh where supported so mobile browser chrome does not clip the sheet.
 */
export default function AppModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "auto",
}: AppModalProps) {
  const widthCap =
    size === "sm"
      ? "max-w-[min(92vw,24rem)]"
      : size === "md"
        ? "max-w-[min(92vw,32rem)]"
        : size === "lg"
          ? "max-w-[min(96vw,42rem)]"
          : "max-w-[min(96vw,40rem)]";

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
          style={{
            paddingTop: "max(0.75rem, env(safe-area-inset-top))",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
            paddingRight: "max(0.75rem, env(safe-area-inset-right))",
          }}
        >
          <motion.button
            type="button"
            aria-label="Close backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2 }}
            className={`relative z-10 flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/50 ${widthCap}`}
            style={{
              maxHeight: "min(90dvh, 90vh, 40rem)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0 pr-2">
                <h2 className="text-base font-bold leading-snug text-white">{title}</h2>
                {subtitle ? (
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">{subtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5 sm:py-4"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {children}
            </div>

            {footer ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-800 bg-slate-900/95 px-4 py-3 sm:px-5">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export const modalInputClass =
  "mt-1 w-full max-w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60";

export const modalPrimaryBtn =
  "rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-400 disabled:opacity-50";

export const modalGhostBtn =
  "rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800";

export function ModalField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block text-xs font-semibold text-slate-300 last:mb-0">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
