import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  CheckCircle,
  Circle,
  GearSix,
  UsersThree,
  Money,
  ListChecks,
  CaretRight,
  X,
} from "@phosphor-icons/react";
import type { Chama, ContributionPlan, Member } from "@/types/chama";
import { getEnabledKitCodes } from "@/lib/kitVisibility";

export type SetupStepId =
  | "pots"
  | "payment"
  | "plans"
  | "people"
  | "fines";

type Step = {
  id: SetupStepId;
  title: string;
  detail: string;
  done: boolean;
};

type Props = {
  chama: Chama;
  members: Member[];
  plans?: ContributionPlan[];
  isChair: boolean;
  /** Open Chama Finance desk / panel */
  onGoSettings: () => void;
  onGoMembers: () => void;
  onGoPlans: () => void;
  onMarkComplete?: () => void;
};

function loadDismissed(chamaId: string): boolean {
  try {
    return localStorage.getItem(`cv-setup-done-${chamaId}`) === "1";
  } catch {
    return false;
  }
}

function saveDismissed(chamaId: string) {
  try {
    localStorage.setItem(`cv-setup-done-${chamaId}`, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Self-guided checklist for a new chama until it can run contributions & loans.
 */
export default function ChamaSetupGuide({
  chama,
  members,
  plans: plansProp,
  isChair,
  onGoSettings,
  onGoMembers,
  onGoPlans,
  onMarkComplete,
}: Props) {
  const [dismissed, setDismissed] = useState(() => loadDismissed(chama.id));
  const [open, setOpen] = useState(true);
  const [plans, setPlans] = useState<ContributionPlan[]>(plansProp || []);

  useEffect(() => {
    if (plansProp && plansProp.length) {
      setPlans(plansProp);
      return;
    }
    void (async () => {
      try {
        const { data } = await supabase.rpc("list_contribution_plans", {
          p_chama_id: chama.id,
        });
        setPlans((Array.isArray(data) ? data : []) as ContributionPlan[]);
      } catch {
        setPlans([]);
      }
    })();
  }, [chama.id, plansProp]);

  const steps: Step[] = useMemo(() => {
    const enabled = getEnabledKitCodes(chama);
    const potsDone = Array.isArray(enabled) && enabled.length > 0;
    const payMode = chama.constitution?.paymentMode;
    const paymentDone = payMode === "manual_confirm" || payMode === "mpesa_stk" || payMode === "both";
    const activePlans = (plans || []).filter((p) => {
      const row = p as ContributionPlan & { is_active?: boolean };
      return row.isActive !== false && row.is_active !== false;
    });
    const plansDone = activePlans.length > 0;
    const people = (members || []).filter(
      (m) => m.status === "active" && m.role !== "New Applicant",
    );
    const hasTreasurer = people.some((m) => m.role === "Treasurer");
    const multiMember = people.length >= 2;
    const peopleDone = hasTreasurer || multiMember;
    const rate = Number(chama.constitution?.lateFineRate ?? 0);
    const finesDone = rate > 0 || Boolean(chama.constitution?.lateFineGraceDays != null);

    return [
      {
        id: "pots",
        title: "1. Choose pots the chama uses",
        detail: "Settings → which kits (table banking, welfare, shares…). Hide unused ones.",
        done: potsDone,
      },
      {
        id: "payment",
        title: "2. How members pay",
        detail: "Settings → Manual (treasurer confirms) and/or M-Pesa. Set “pay to” for cash/till.",
        done: paymentDone,
      },
      {
        id: "plans",
        title: "3. Contribution schedules",
        detail: "Create at least one plan (amount, monthly/weekly due date, destination pot).",
        done: plansDone,
      },
      {
        id: "people",
        title: "4. Officials & members",
        detail: "Add members and set a Treasurer (and Secretary if needed) under Members.",
        done: peopleDone,
      },
      {
        id: "fines",
        title: "5. Late fines (optional)",
        detail: "Settings → late fine % and grace days after each pot’s due date.",
        done: finesDone,
      },
    ];
  }, [chama, members, plans]);

  const doneCount = steps.filter((s) => s.done).length;
  const allCoreDone = steps.filter((s) => s.id !== "fines").every((s) => s.done);

  if (!isChair || dismissed) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-3 z-[70] rounded-full border border-emerald-500/40 bg-slate-900 px-4 py-2 text-xs font-bold text-emerald-300 shadow-lg sm:bottom-6"
      >
        Setup {doneCount}/{steps.length}
      </button>
    );
  }

  const go = (id: SetupStepId) => {
    if (id === "people") onGoMembers();
    else if (id === "plans") onGoPlans();
    else onGoSettings();
  };

  return (
    <div className="mb-4 rounded-2xl border border-emerald-500/35 bg-gradient-to-br from-slate-900 to-emerald-950/40 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">
            Set up {chama.name}
          </p>
          <h2 className="mt-0.5 text-lg font-bold text-white">Make this chama work</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Follow the steps in order. When these are done, members can pay, you can approve,
            and the group can vote on loans.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1 text-slate-500 hover:text-white"
          aria-label="Minimize"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {doneCount} of {steps.length} complete
        {allCoreDone ? " · Core setup done" : ""}
      </p>

      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => go(s.id)}
              className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                s.done
                  ? "border-emerald-500/25 bg-emerald-500/10"
                  : "border-slate-700 bg-slate-950/60 hover:border-emerald-500/40"
              }`}
            >
              {s.done ? (
                <CheckCircle size={22} className="mt-0.5 shrink-0 text-emerald-400" weight="fill" />
              ) : (
                <Circle size={22} className="mt-0.5 shrink-0 text-slate-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${s.done ? "text-emerald-100" : "text-white"}`}>
                  {s.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{s.detail}</p>
              </div>
              <CaretRight size={16} className="mt-1 shrink-0 text-slate-500" />
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onGoSettings}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white"
        >
          <GearSix size={16} weight="bold" />
          Open settings
        </button>
        <button
          type="button"
          onClick={onGoMembers}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200"
        >
          <UsersThree size={16} />
          Members
        </button>
        <button
          type="button"
          onClick={onGoPlans}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200"
        >
          <ListChecks size={16} />
          Plans
        </button>
      </div>

      {allCoreDone && (
        <button
          type="button"
          onClick={() => {
            saveDismissed(chama.id);
            setDismissed(true);
            onMarkComplete?.();
          }}
          className="mt-3 w-full rounded-xl border border-emerald-500/40 py-2.5 text-xs font-bold text-emerald-200"
        >
          Setup complete — hide this guide
        </button>
      )}

      <p className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
        <Money size={14} className="mt-0.5 shrink-0" />
        After setup: members pay (Home → Pay) → Treasurer approves manual pays → pots update.
        Loans need votes, then Treasurer disburses.
      </p>
    </div>
  );
}
