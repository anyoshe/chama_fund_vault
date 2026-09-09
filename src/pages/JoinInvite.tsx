import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import ChamaVaultLogo from "@/components/ChamaVaultLogo";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export default function JoinInvite() {
  const { session, refreshMemberships } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      toast.message("Sign in first, then redeem your invite code.");
      navigate("/login");
      return;
    }
    if (!code.trim()) {
      toast.error("Enter the invite code from your chama officials.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("redeem_chama_invite", {
        p_code: code.trim(),
        p_monthly: null,
      });
      if (error) throw error;
      toast.success("Joined chama successfully");
      if (refreshMemberships) await refreshMemberships();
      else window.location.href = "/app";
      navigate("/app");
      void data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not redeem invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
      <ChamaVaultLogo size={56} showWordmark />
      <form
        onSubmit={redeem}
        className="mt-8 w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6"
      >
        <h1 className="text-lg font-bold text-white">Join a chama with invite code</h1>
        <p className="text-xs text-slate-400">
          Ask your Chairperson or Secretary for an 8-character code.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. A1B2C3D4"
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm tracking-widest text-white outline-none focus:border-emerald-500/50"
          maxLength={12}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join chama"}
        </button>
        <p className="text-center text-[11px] text-slate-500">
          <Link to="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
          {" · "}
          <Link to="/register" className="text-emerald-400 hover:underline">
            Create a new chama
          </Link>
        </p>
      </form>
    </div>
  );
}
