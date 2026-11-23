import { useState, useEffect } from "react";
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

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("code");
      if (q) setCode(q.trim());
    } catch {
      /* ignore */
    }
  }, []);

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
      });
      if (error) throw error;
      const name = (data as { chamaName?: string } | null)?.chamaName;
      toast.success(name ? `Joined ${name}` : "Joined chama successfully");
      if (refreshMemberships) await refreshMemberships();
      navigate("/app");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not redeem invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cv-app-shell flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-10">
      <Link to="/" className="mb-6">
        <ChamaVaultLogo />
      </Link>
      <form
        onSubmit={redeem}
        className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl"
      >
        <h1 className="text-lg font-bold text-white">Join with invite code</h1>
        <p className="text-sm text-slate-300">
          Get the code from your chair or treasurer. Sign in first, then enter it here.
        </p>
        <label className="block text-xs font-semibold text-slate-300">
          Invite code
          <input
            className="mt-1 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 font-mono text-base tracking-widest text-white uppercase outline-none focus:border-emerald-500"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. A1B2C3D4"
            autoComplete="off"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join chama"}
        </button>
        <p className="text-center text-xs text-slate-400">
          No account?{" "}
          <Link to="/login" className="font-semibold text-emerald-300">
            Sign in / register
          </Link>
        </p>
      </form>
    </div>
  );
}
