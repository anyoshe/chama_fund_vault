import { useCallback, useState } from "react";
import { WarningCircle, CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import {
  ORDERED_SQL_FILES,
  RPC_TO_SQL,
  TABLE_TO_SQL,
  type HealthResult,
} from "@/lib/migrationChecklist";
import { toast } from "sonner";

export default function SystemHealthCheck() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [rpcMissing, setRpcMissing] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setRpcMissing(false);
    try {
      const { data, error } = await supabase.rpc("chamavault_health_check");
      if (error) {
        // Health function itself not installed
        setRpcMissing(true);
        setResult({
          ok: false,
          functionsMissing: ["chamavault_health_check"],
          tablesMissing: [],
          hint: "Run supabase/chamavault_health_check.sql first, then click Check again",
        });
        toast.error("Health check SQL not installed yet");
        return;
      }
      const r = data as HealthResult;
      setResult(r);
      if (r.ok) toast.success("All critical SQL pieces found");
      else toast.message("Some database pieces are missing — see list");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Health check failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const missingFns = result?.functionsMissing ?? [];
  const missingTbs = result?.tablesMissing ?? [];

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-white">System health · SQL checklist</p>
          <p className="mt-1 text-xs text-slate-400">
            Checks whether critical database functions and tables exist. Run missing
            files in Supabase → SQL Editor.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void run()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          <ArrowsClockwise size={14} className={loading ? "animate-spin" : ""} />
          {loading ? "Checking…" : "Run check"}
        </button>
      </div>

      {rpcMissing && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          First run: <code className="text-amber-200">supabase/chamavault_health_check.sql</code>
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
              result.ok
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                : "border border-rose-500/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {result.ok ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} />}
            {result.ok ? "Database looks complete" : "Gaps found — install missing SQL"}
          </div>

          {missingFns.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Missing functions ({missingFns.length})
              </p>
              <ul className="mt-2 space-y-2">
                {missingFns.map((fn) => {
                  const meta = RPC_TO_SQL[fn];
                  return (
                    <li
                      key={fn}
                      className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs"
                    >
                      <p className="font-mono font-semibold text-rose-200">{fn}</p>
                      <p className="mt-0.5 text-slate-400">
                        {meta?.purpose || "Required for core chama features"}
                      </p>
                      <p className="mt-1 text-amber-200/90">
                        Run: <span className="font-semibold">{meta?.file || "see supabase/ folder"}</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {missingTbs.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Missing tables ({missingTbs.length})
              </p>
              <ul className="mt-2 space-y-1.5">
                {missingTbs.map((tb) => (
                  <li key={tb} className="text-xs text-slate-300">
                    <span className="font-mono text-rose-200">{tb}</span>
                    {" → "}
                    {TABLE_TO_SQL[tb] || "schema / related migration"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Recommended install order
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-slate-400">
              {ORDERED_SQL_FILES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
