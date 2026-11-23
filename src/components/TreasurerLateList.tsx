import { useCallback, useEffect, useState } from "react";
import { WhatsappLogo, WarningCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fmtKsh } from "@/data/mockChamaData";

type LateItem = {
  planName?: string;
  periodKey?: string;
  dueDate?: string;
  fineStartsOn?: string;
  outstanding?: number;
};

type LateRow = {
  memberId: string;
  name: string;
  phone: string;
  role?: string;
  principalBehind: number;
  finesOutstanding: number;
  lateItems?: LateItem[];
};

function waPhone(raw: string): string | null {
  let p = (raw || "").replace(/\D/g, "");
  if (!p) return null;
  if (p.startsWith("0") && p.length >= 9) p = "254" + p.slice(1);
  if (p.length === 9) p = "254" + p;
  if (!p.startsWith("254") || p.length < 12) return null;
  return p;
}

function buildReminderMessage(
  chamaName: string,
  memberName: string,
  principal: number,
  fines: number,
  items: LateItem[],
): string {
  const lines = [
    `Habari ${memberName},`,
    ``,
    `This is a reminder from *${chamaName}* (treasurer).`,
    ``,
  ];
  if (principal > 0) {
    lines.push(`You have overdue contributions: *${fmtKsh(principal)}*`);
    for (const it of items.slice(0, 5)) {
      lines.push(
        `• ${it.planName || "Contribution"} (${it.periodKey || ""}) due ${String(it.dueDate || "").slice(0, 10)} — ${fmtKsh(Number(it.outstanding) || 0)}`,
      );
    }
  }
  if (fines > 0) {
    lines.push(``);
    lines.push(`Late fines: *${fmtKsh(fines)}*`);
  }
  lines.push(``);
  lines.push(`Total to clear: *${fmtKsh(principal + fines)}*`);
  lines.push(`Please pay via the ChamaVault app (or as agreed by the group).`);
  lines.push(``);
  lines.push(`Asante.`);
  return lines.join("\n");
}

export default function TreasurerLateList({
  chamaId,
  chamaName,
}: {
  chamaId: string;
  chamaName: string;
}) {
  const [rows, setRows] = useState<LateRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("list_late_members_for_treasurer", {
        p_chama_id: chamaId,
      });
      if (error) throw error;
      setRows(Array.isArray(data) ? (data as LateRow[]) : []);
    } catch (e) {
      console.warn(e);
      setRows([]);
      toast.error(
        e instanceof Error ? e.message : "Could not load late members (run treasurer_late_members.sql)",
      );
    } finally {
      setLoading(false);
    }
  }, [chamaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openWhatsApp = (row: LateRow) => {
    const phone = waPhone(row.phone);
    if (!phone) {
      toast.error("No valid phone on this member’s profile — add a number first");
      return;
    }
    const text = buildReminderMessage(
      chamaName,
      row.name.split(" ")[0] || row.name,
      Number(row.principalBehind) || 0,
      Number(row.finesOutstanding) || 0,
      row.lateItems || [],
    );
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-2xl border border-rose-500/25 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-white">Late contributions</p>
          <p className="mt-1 text-xs text-slate-300">
            Members past due (after grace). Fines shown if assessed. WhatsApp opens with a ready
            message — you only press Send.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-600 px-2 py-1 text-[11px] font-bold text-slate-300"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-4 text-center text-sm text-emerald-100">
          No one is late right now
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const total =
              (Number(row.principalBehind) || 0) + (Number(row.finesOutstanding) || 0);
            return (
              <li
                key={row.memberId}
                className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{row.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {row.phone || "No phone on profile"}
                      {row.role ? ` · ${row.role}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="font-mono text-amber-200">
                        Dues {fmtKsh(Number(row.principalBehind) || 0)}
                      </span>
                      {(Number(row.finesOutstanding) || 0) > 0 && (
                        <span className="font-mono text-rose-300">
                          Fines {fmtKsh(Number(row.finesOutstanding) || 0)}
                        </span>
                      )}
                      <span className="font-mono font-bold text-white">
                        Total {fmtKsh(total)}
                      </span>
                    </div>
                    {(row.lateItems || []).length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-400">
                        {(row.lateItems || []).slice(0, 4).map((it, i) => (
                          <li key={i}>
                            {it.planName} · due {String(it.dueDate || "").slice(0, 10)}
                            {it.fineStartsOn
                              ? ` · fines from ${String(it.fineStartsOn).slice(0, 10)}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openWhatsApp(row)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-xs font-bold text-slate-950 hover:brightness-110"
                  >
                    <WhatsappLogo size={18} weight="fill" />
                    WhatsApp remind
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
        <WarningCircle size={14} className="mt-0.5 shrink-0" />
        WhatsApp opens on this device. The member must have a phone saved on their profile
        (254…).
      </p>
    </div>
  );
}
