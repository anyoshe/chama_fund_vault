import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Slot = {
  memberId: string;
  name: string;
  slotNumber: number;
  claimedAt?: string;
};

type Status = {
  hasDraw: boolean;
  drawId?: string;
  status?: string;
  memberCount?: number;
  claimedCount?: number;
  closesAt?: string;
  myNumber?: number | null;
  slots?: Slot[];
  payoutOrder?: Slot[];
};

type Recipient = {
  ok: boolean;
  name?: string;
  slotNumber?: number;
  position?: number;
  total?: number;
  reason?: string;
};

export default function MgrWheel({
  chamaId,
  isOfficial,
}: {
  chamaId: string;
  isOfficial?: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [displayNum, setDisplayNum] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data }, { data: rec }] = await Promise.all([
        supabase.rpc("get_mgr_wheel_status", { p_chama_id: chamaId }),
        supabase.rpc("get_mgr_current_recipient", { p_chama_id: chamaId }),
      ]);
      setStatus((data || { hasDraw: false }) as Status);
      setRecipient((rec || null) as Recipient | null);
    } catch {
      setStatus({ hasDraw: false });
    }
  }, [chamaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startDraw = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("start_mgr_wheel_draw", {
        p_chama_id: chamaId,
        p_hours_open: 72,
      });
      if (error) throw error;
      toast.success("Wheel is open — members can pick a number");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open wheel");
    } finally {
      setBusy(false);
    }
  };

  const spin = async () => {
    if (spinning) return;
    setSpinning(true);
    setDisplayNum(null);
    // Visual spin
    let ticks = 0;
    const max = status?.memberCount || 12;
    const interval = window.setInterval(() => {
      setDisplayNum(1 + Math.floor(Math.random() * max));
      ticks += 1;
      if (ticks > 18) window.clearInterval(interval);
    }, 80);

    try {
      const { data, error } = await supabase.rpc("claim_mgr_wheel_number", {
        p_chama_id: chamaId,
      });
      if (error) throw error;
      const n = Number((data as { slotNumber?: number })?.slotNumber);
      window.setTimeout(() => {
        window.clearInterval(interval);
        setDisplayNum(n);
        setSpinning(false);
        if ((data as { alreadyClaimed?: boolean })?.alreadyClaimed) {
          toast.message(`You already have number ${n}`);
        } else {
          toast.success(`Your MGR number is ${n}`);
        }
        void load();
      }, 1600);
    } catch (e) {
      window.clearInterval(interval);
      setSpinning(false);
      toast.error(e instanceof Error ? e.message : "Could not claim a number");
    }
  };

  const advance = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("advance_mgr_wheel_turn", {
        p_chama_id: chamaId,
      });
      if (error) throw error;
      const paid = (data as { paidOrAdvanced?: { name?: string; slotNumber?: number } })
        ?.paidOrAdvanced;
      toast.success(
        paid?.name
          ? `Turn advanced · was #${paid.slotNumber} ${paid.name}`
          : "Turn advanced",
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Advance failed");
    } finally {
      setBusy(false);
    }
  };

  const open = status?.status === "open";
  const active = status?.status === "active";

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-slate-900/80 p-4">
      <p className="text-sm font-bold text-white">Merry-go-round wheel</p>
      <p className="mt-1 text-xs text-slate-300">
        Everyone picks a unique random number in the open period. Payout order follows
        numbers 1 → 2 → 3… (fair each new round).
      </p>

      {recipient?.ok && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <p className="text-[11px] font-bold uppercase text-emerald-300/90">On the line now</p>
          <p className="text-lg font-bold text-white">
            #{recipient.slotNumber} · {recipient.name}
          </p>
          <p className="text-xs text-slate-300">
            Position {recipient.position} of {recipient.total}
          </p>
        </div>
      )}

      {!status?.hasDraw && (
        <p className="mt-3 text-sm text-slate-400">
          No active draw. Officials open a new wheel when a new cycle starts.
        </p>
      )}

      {status?.hasDraw && (
        <div className="mt-3 space-y-2 text-xs text-slate-300">
          <p>
            Status:{" "}
            <span className="font-semibold text-white">{status.status}</span>
            {" · "}
            {status.claimedCount}/{status.memberCount} numbers taken
          </p>
          {status.myNumber != null && (
            <p className="text-base font-bold text-violet-200">
              Your number: #{status.myNumber}
            </p>
          )}
        </div>
      )}

      {/* Wheel display */}
      <div className="mt-4 flex flex-col items-center gap-3">
        <motion.div
          animate={spinning ? { rotate: 360 } : { rotate: 0 }}
          transition={
            spinning
              ? { repeat: Infinity, duration: 0.45, ease: "linear" }
              : { duration: 0.3 }
          }
          className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-violet-400/50 bg-gradient-to-br from-violet-600/40 to-slate-950 shadow-lg shadow-violet-500/20"
        >
          <span className="font-mono text-4xl font-bold text-white">
            {displayNum ?? status?.myNumber ?? "—"}
          </span>
        </motion.div>

        {open && status?.myNumber == null && (
          <button
            type="button"
            disabled={spinning}
            onClick={() => void spin()}
            className="w-full max-w-xs rounded-xl bg-violet-500 py-3 text-sm font-bold text-white hover:bg-violet-400 disabled:opacity-50"
          >
            {spinning ? "Spinning…" : "Spin the wheel"}
          </button>
        )}
        {open && status?.myNumber != null && (
          <p className="text-center text-xs text-slate-400">
            You already have a number. Wait for others to finish.
          </p>
        )}
      </div>

      {active && (status?.payoutOrder?.length || 0) > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase text-slate-500">Payout order</p>
          <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
            {(status?.payoutOrder || []).map((s) => (
              <li
                key={s.memberId}
                className="flex justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1.5"
              >
                <span className="text-slate-200">
                  <span className="font-mono font-bold text-violet-300">#{s.slotNumber}</span>{" "}
                  {s.name}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {isOfficial && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void startDraw()}
            className="rounded-xl border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-xs font-bold text-violet-200"
          >
            Open new wheel round
          </button>
          {active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void advance()}
              className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-200"
            >
              Advance to next number
            </button>
          )}
        </div>
      )}
    </div>
  );
}
