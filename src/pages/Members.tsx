import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  SpinnerGap,
  UserPlus,
  Crown,
  Envelope,
  Phone,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import type { MemberRole } from "@/types/chama";
import { fmtKsh } from "@/data/mockChamaData";

interface MemberRow {
  id: string;
  user_id: string;
  role: MemberRole;
  monthly_contribution: number;
  total_paid: number;
  active_loans: number;
  status: string;
  joined_at: string;
  profile: {
    full_name: string;
    email: string;
    phone: string | null;
    avatar_hue: number;
  } | null;
}

const ROLES: MemberRole[] = [
  "Chairperson",
  "Treasurer",
  "Secretary",
  "Active Member",
  "New Applicant",
];

export default function Members() {
  const { activeChamaId, user } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Add form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<MemberRole>("Active Member");
  const [monthly, setMonthly] = useState(5000);
  const [submitting, setSubmitting] = useState(false);

  const myMembership = user?.memberships.find((m) => m.chama_id === activeChamaId);
  const canManage =
    myMembership?.role === "Chairperson" || myMembership?.role === "Secretary";

  const loadMembers = async () => {
    if (!activeChamaId) return;
    setLoading(true);

    // Security-definer RPCs avoid RLS recursion on chama_members
    const { data: memberRows, error } = await supabase.rpc("list_chama_members", {
      p_chama_id: activeChamaId,
    });

    if (error) {
      console.error(error);
      toast.error("Could not load members");
      setLoading(false);
      return;
    }

    const { data: profiles } = await supabase.rpc("list_chama_profiles", {
      p_chama_id: activeChamaId,
    });

    const profileMap: Record<
      string,
      { full_name: string; email: string; phone: string | null; avatar_hue: number }
    > = {};
    for (const p of profiles ?? []) {
      profileMap[p.id] = {
        full_name: p.full_name,
        email: p.email,
        phone: p.phone,
        avatar_hue: p.avatar_hue,
      };
    }

    const rows = (memberRows ?? []) as MemberRow[];
    setMembers(
      rows
        .slice()
        .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
        .map((row) => ({
          ...row,
          profile: profileMap[row.user_id] ?? null,
        })),
    );
    setLoading(false);
  };

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChamaId]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChamaId || !canManage) return;
    if (!fullName.trim() || !email.trim() || !password) {
      toast.error("Name, email and temporary password are required");
      return;
    }
    setSubmitting(true);

    // Create auth user via signUp (they get credentials immediately)
    // Note: in production you'd use an invite edge function / admin API
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        },
      },
    });

    if (signUpError || !signUpData.user) {
      setSubmitting(false);
      toast.error(signUpError?.message ?? "Failed to create user account");
      return;
    }

    const newUserId = signUpData.user.id;

    // Ensure profile
    await supabase.from("profiles").upsert({
      id: newUserId,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim() || null,
      avatar_hue: Math.floor(Math.random() * 360),
    });

    // Add membership
    const { error: memError } = await supabase.from("chama_members").insert({
      chama_id: activeChamaId,
      user_id: newUserId,
      role,
      monthly_contribution: monthly,
      total_paid: 0,
      active_loans: 0,
      status: "active",
    });

    setSubmitting(false);

    if (memError) {
      toast.error(memError.message);
      return;
    }

    toast.success(`${fullName} added — they can log in with their email/phone + password`);
    setShowAdd(false);
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setRole("Active Member");
    loadMembers();
  };

  if (!activeChamaId) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400">
        Select or create a chama first.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Members</h2>
          <p className="text-sm text-slate-400">
            People with login access to this chama
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-500"
          >
            <UserPlus size={18} weight="bold" />
            Add member
          </button>
        )}
      </div>

      {showAdd && canManage && (
        <motion.form
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleAddMember}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 space-y-4"
        >
          <p className="text-sm font-semibold text-slate-200">
            Create login credentials for a new member
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-500/60"
              placeholder="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <input
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-500/60"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-500/60"
              placeholder="Phone (optional) e.g. +2547…"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-emerald-500/60"
              placeholder="Temporary password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <select
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/60"
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-emerald-500/60"
              type="number"
              min={0}
              step={100}
              value={monthly}
              onChange={(e) => setMonthly(Number(e.target.value) || 0)}
              placeholder="Monthly contribution"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {submitting ? (
                <SpinnerGap size={16} className="animate-spin" />
              ) : (
                <Plus size={16} weight="bold" />
              )}
              Create & add
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Share the email/phone and temporary password with the member so they can sign in.
            They should change the password after first login.
          </p>
        </motion.form>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <SpinnerGap size={28} className="animate-spin text-emerald-400" />
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 py-12 text-center text-slate-500">
          No members yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Member</th>
                <th className="hidden px-4 py-3 font-semibold sm:table-cell">Contact</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="hidden px-4 py-3 font-semibold md:table-cell">Saved</th>
                <th className="hidden px-4 py-3 font-semibold lg:table-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {members.map((m) => {
                const name = m.profile?.full_name ?? "Unknown";
                const hue = m.profile?.avatar_hue ?? 150;
                return (
                  <tr key={m.id} className="bg-slate-950/40 hover:bg-slate-900/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                          style={{
                            background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 40) % 360} 70% 30%))`,
                          }}
                        >
                          {name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-100">{name}</p>
                          <p className="text-[11px] text-slate-500 sm:hidden">{m.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <div className="space-y-0.5 text-xs text-slate-400">
                        {m.profile?.email && (
                          <p className="flex items-center gap-1.5">
                            <Envelope size={12} /> {m.profile.email}
                          </p>
                        )}
                        {m.profile?.phone && (
                          <p className="flex items-center gap-1.5">
                            <Phone size={12} /> {m.profile.phone}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-medium text-slate-300">
                        {m.role === "Chairperson" && (
                          <Crown size={12} className="text-amber-400" />
                        )}
                        {m.role}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-slate-300 md:table-cell">
                      {fmtKsh(m.total_paid)}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          m.status === "active"
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-slate-700 text-slate-400"
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
