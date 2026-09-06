import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { AuthUser, ChamaMembership, Profile } from "@/types/auth";
import type { ChamaActivity, ChamaKind, MemberRole } from "@/types/chama";

interface RegisterChamaPayload {
  // Admin account
  fullName: string;
  email: string;
  phone: string;
  password: string;
  // Chama
  chamaName: string;
  tagline: string;
  /** Multi-select activities that apply to this chama */
  activities: ChamaActivity[];
  minMonthlyContribution: number;
}

function deriveKind(activities: ChamaActivity[]): ChamaKind {
  if (activities.length === 0) return "hybrid";
  if (activities.length > 1) return "hybrid";
  const only = activities[0];
  if (only === "merry-go-round") return "merry-go-round";
  if (only === "table-banking" || only === "member-loans") return "table-banking";
  if (only === "welfare" || only === "education-fund") return "welfare-pot";
  if (only === "investment-pool" || only === "housing-project" || only === "agribusiness" || only === "share-capital") {
    return "investment-pool";
  }
  return "hybrid";
}

interface AuthContextValue {
  session: Session | null;
  user: AuthUser | null;
  loading: boolean;
  activeChamaId: string | null;
  setActiveChamaId: (id: string) => void;
  login: (identifier: string, password: string) => Promise<{ error?: string }>;
  registerChama: (payload: RegisterChamaPayload) => Promise<{ error?: string; needsEmailConfirmation?: boolean }>;
  resetPassword: (currentPassword: string, newPassword: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isPhoneLike(value: string): boolean {
  const cleaned = value.replace(/[\s\-()]/g, "");
  return /^\+?\d{9,15}$/.test(cleaned);
}

function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-()]/g, "");
  if (p.startsWith("0") && p.length === 10) {
    // Kenyan local → international
    p = "+254" + p.slice(1);
  }
  if (!p.startsWith("+") && p.length >= 9) {
    p = "+" + p;
  }
  return p;
}


const PENDING_CHAMA_KEY = "chamavault-pending-chama";

interface PendingChama {
  chamaName: string;
  tagline: string;
  activities: ChamaActivity[];
  minMonthlyContribution: number;
  fullName: string;
  phone: string | null;
  email: string;
}

async function createChamaForUser(
  userId: string,
  payload: {
    chamaName: string;
    tagline: string;
    activities: ChamaActivity[];
    minMonthlyContribution: number;
  },
) {
  const kind = deriveKind(payload.activities);
  const normalizedName = payload.chamaName.trim();
  const { data: existingChama, error: lookupError } = await supabase
    .from("chamas")
    .select("id")
    .eq("created_by", userId)
    .ilike("name", normalizedName)
    .order("created_at", { ascending: true })
    .limit(1);
  if (lookupError) return { error: lookupError.message };
  if (existingChama?.[0]) {
    const chamaId = existingChama[0].id;
    const { data: existingMembership } = await supabase
      .from("chama_members")
      .select("id")
      .eq("chama_id", chamaId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!existingMembership) {
      const { error } = await supabase.from("chama_members").insert({
        chama_id: chamaId,
        user_id: userId,
        role: "Chairperson" as MemberRole,
        monthly_contribution: payload.minMonthlyContribution,
        total_paid: 0,
        active_loans: 0,
        status: "active",
      });
      if (error) return { error: error.message };
    }
    return { chamaId: chamaId as string };
  }

  const { data: chama, error: chamaError } = await supabase
    .from("chamas")
    .insert({
      name: normalizedName,
      tagline: payload.tagline.trim() || `${normalizedName} savings group`,
      kind,
      pool_balance: 0,
      monthly_target: payload.minMonthlyContribution,
      month_collected: 0,
      constitution: {
        minMonthlyContribution: payload.minMonthlyContribution,
        lateFineRate: 5,
        quorumPercent: 60,
        maxLoanMultiple: 3,
        payoutCycle: "1st Monday",
        activities: payload.activities,
      },
      currency: "KES",
      created_by: userId,
    })
    .select()
    .single();

  if (chamaError?.code === "23505") {
    const { data: duplicate } = await supabase
      .from("chamas")
      .select("id")
      .eq("created_by", userId)
      .ilike("name", normalizedName)
      .order("created_at", { ascending: true })
      .limit(1);
    if (duplicate?.[0]) return { chamaId: duplicate[0].id as string };
  }
  if (chamaError || !chama) {
    return { error: chamaError?.message ?? "Failed to create chama." };
  }

  const { error: memberError } = await supabase.from("chama_members").insert({
    chama_id: chama.id,
    user_id: userId,
    role: "Chairperson" as MemberRole,
    monthly_contribution: payload.minMonthlyContribution,
    total_paid: 0,
    active_loans: 0,
    status: "active",
  });

  if (memberError) {
    return { error: memberError.message };
  }
  return { chamaId: chama.id as string };
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("fetchProfile", error);
    return null;
  }
  return data as Profile | null;
}

async function fetchMemberships(userId: string): Promise<ChamaMembership[]> {
  const { data, error } = await supabase
    .from("chama_members")
    .select("*, chama:chamas(*)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  if (error) {
    console.error("fetchMemberships", error);
    return [];
  }
  const memberships = (data ?? []) as ChamaMembership[];
  const seenChamas = new Set<string>();
  return memberships.filter((membership) => {
    if (seenChamas.has(membership.chama_id)) return false;
    seenChamas.add(membership.chama_id);
    return true;
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeChamaId, setActiveChamaId] = useState<string | null>(null);

  const hydrateUser = useCallback(async (authUser: User | null) => {
    if (!authUser) {
      setUser(null);
      setActiveChamaId(null);
      return;
    }

    // Finish chama creation deferred from email-confirm signup + always sync phone
    try {
      const raw = localStorage.getItem(PENDING_CHAMA_KEY);
      const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
      const metaPhone =
        typeof meta.phone === "string" && meta.phone.trim()
          ? normalizePhone(meta.phone)
          : null;
      const metaName =
        typeof meta.full_name === "string" && meta.full_name.trim()
          ? meta.full_name.trim()
          : null;

      if (raw) {
        const pending = JSON.parse(raw) as PendingChama;
        const existing = await fetchMemberships(authUser.id);
        // Always write profile with phone (pending wins, else metadata)
        await supabase.from("profiles").upsert({
          id: authUser.id,
          full_name: pending.fullName || metaName || authUser.email?.split("@")[0] || "Member",
          email: (authUser.email ?? pending.email).toLowerCase(),
          phone: pending.phone || metaPhone,
          avatar_hue: Math.floor(Math.random() * 360),
        });
        if (existing.length === 0) {
          await createChamaForUser(authUser.id, pending);
        }
        localStorage.removeItem(PENDING_CHAMA_KEY);
      } else {
        // No pending chama — still ensure phone/name land on profile after confirm
        const current = await fetchProfile(authUser.id);
        if (!current?.phone && metaPhone) {
          await supabase.from("profiles").upsert({
            id: authUser.id,
            full_name: current?.full_name || metaName || authUser.email?.split("@")[0] || "Member",
            email: (authUser.email ?? current?.email ?? "").toLowerCase(),
            phone: metaPhone,
            avatar_hue: current?.avatar_hue ?? Math.floor(Math.random() * 360),
          });
        } else if (!current) {
          await supabase.from("profiles").upsert({
            id: authUser.id,
            full_name: metaName || authUser.email?.split("@")[0] || "Member",
            email: (authUser.email ?? "").toLowerCase(),
            phone: metaPhone,
            avatar_hue: Math.floor(Math.random() * 360),
          });
        }
      }
    } catch (e) {
      console.error("pending chama / profile sync", e);
    }

    const [profile, memberships] = await Promise.all([
      fetchProfile(authUser.id),
      fetchMemberships(authUser.id),
    ]);
    setUser({
      id: authUser.id,
      email: authUser.email ?? "",
      profile,
      memberships,
    });
    if (memberships.length > 0) {
      setActiveChamaId((prev) => {
        if (prev && memberships.some((m) => m.chama_id === prev)) return prev;
        return memberships[0].chama_id;
      });
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      hydrateUser(data.session?.user ?? null).finally(() => {
        if (mounted) setLoading(false);
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      hydrateUser(nextSession?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [hydrateUser]);

  const refreshMemberships = useCallback(async () => {
    if (!session?.user) return;
    const memberships = await fetchMemberships(session.user.id);
    setUser((prev) => (prev ? { ...prev, memberships } : prev));
  }, [session]);

  const login = useCallback(async (identifier: string, password: string) => {
    const trimmed = identifier.trim();
    if (!trimmed || !password) {
      return { error: "Please enter your email/phone and password." };
    }

    let email = trimmed;

    if (isPhoneLike(trimmed)) {
      const phone = normalizePhone(trimmed);
      const { data: resolvedEmail, error: lookupError } = await supabase.rpc(
        "resolve_login_email",
        { p_phone: phone },
      );
      if (lookupError || !resolvedEmail) {
        return {
          error: "No account found for this phone number. Try email instead.",
        };
      }
      email = resolvedEmail;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }
    return {};
  }, []);

  const registerChama = useCallback(async (payload: RegisterChamaPayload) => {
    const {
      fullName,
      email,
      phone,
      password,
      chamaName,
      tagline,
      activities,
      minMonthlyContribution,
    } = payload;

    if (!fullName || !email || !password || !chamaName) {
      return { error: "Please fill in all required fields." };
    }
    if (password.length < 6) {
      return { error: "Password must be at least 6 characters." };
    }
    if (!activities || activities.length === 0) {
      return { error: "Select at least one activity that applies to your chama." };
    }

    const normalizedPhone = phone ? normalizePhone(phone) : null;

    // 1. Create auth user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: normalizedPhone,
        },
      },
    });

    if (signUpError) {
      return { error: signUpError.message };
    }

    const newUser = signUpData.user;
    if (!newUser) {
      return { error: "Could not create account. Please try again." };
    }

    // 2–4. Profile + chama (or defer if email confirmation required)
    // Profile upsert (may fail without session if email confirm is on — non-fatal)
    const avatarHue = Math.floor(Math.random() * 360);
    await supabase.from("profiles").upsert({
      id: newUser.id,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      avatar_hue: avatarHue,
    });

    // If email confirmation is required, there is often no session yet.
    // Creating chama would fail RLS — stash and finish after first login.
    const { data: sessionData } = await supabase.auth.getSession();
    const hasSession = Boolean(sessionData.session);

    if (!hasSession) {
      const pending: PendingChama = {
        chamaName,
        tagline,
        activities,
        minMonthlyContribution,
        fullName: fullName.trim(),
        phone: normalizedPhone,
        email: email.trim().toLowerCase(),
      };
      try {
        localStorage.setItem(PENDING_CHAMA_KEY, JSON.stringify(pending));
      } catch {
        /* ignore */
      }
      return { needsEmailConfirmation: true };
    }

    const created = await createChamaForUser(newUser.id, {
      chamaName,
      tagline,
      activities,
      minMonthlyContribution,
    });
    if (created.error) {
      return { error: created.error };
    }

    await hydrateUser(newUser);
    return {};
  }, [hydrateUser]);


  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setActiveChamaId(null);
  }, []);

  const resetPassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (currentPassword.length === 0) {
      return { error: "Enter your current password." };
    }
    if (newPassword.length < 6) {
      return { error: "Password must be at least 6 characters." };
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData.session?.user.email;
    if (!email) {
      return { error: "Could not verify the current account." };
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      return { error: "Current password is incorrect." };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return error ? { error: error.message } : {};
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      loading,
      activeChamaId,
      setActiveChamaId,
      login,
      registerChama,
      resetPassword,
      logout,
      refreshMemberships,
    }),
    [
      session,
      user,
      loading,
      activeChamaId,
      login,
      registerChama,
      logout,
      refreshMemberships,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
