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
import type { ChamaKind, MemberRole } from "@/types/chama";

interface RegisterChamaPayload {
  // Admin account
  fullName: string;
  email: string;
  phone: string;
  password: string;
  // Chama
  chamaName: string;
  tagline: string;
  kind: ChamaKind;
  minMonthlyContribution: number;
}

interface AuthContextValue {
  session: Session | null;
  user: AuthUser | null;
  loading: boolean;
  activeChamaId: string | null;
  setActiveChamaId: (id: string) => void;
  login: (identifier: string, password: string) => Promise<{ error?: string }>;
  registerChama: (payload: RegisterChamaPayload) => Promise<{ error?: string }>;
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
    .eq("status", "active");
  if (error) {
    console.error("fetchMemberships", error);
    return [];
  }
  return (data ?? []) as ChamaMembership[];
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
      const { data: profile, error: lookupError } = await supabase
        .from("profiles")
        .select("email")
        .eq("phone", phone)
        .maybeSingle();

      if (lookupError || !profile?.email) {
        return {
          error: "No account found for this phone number. Try email instead.",
        };
      }
      email = profile.email;
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
      kind,
      minMonthlyContribution,
    } = payload;

    if (!fullName || !email || !password || !chamaName) {
      return { error: "Please fill in all required fields." };
    }
    if (password.length < 6) {
      return { error: "Password must be at least 6 characters." };
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

    // 2. Upsert profile (trigger may already create it; we ensure phone/name)
    const avatarHue = Math.floor(Math.random() * 360);
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: newUser.id,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: normalizedPhone,
      avatar_hue: avatarHue,
    });

    if (profileError) {
      console.error("profile upsert", profileError);
      // non-fatal if trigger already created it
    }

    // 3. Create chama
    const { data: chama, error: chamaError } = await supabase
      .from("chamas")
      .insert({
        name: chamaName.trim(),
        tagline: tagline.trim() || `${chamaName.trim()} savings group`,
        kind,
        pool_balance: 0,
        monthly_target: minMonthlyContribution,
        month_collected: 0,
        constitution: {
          minMonthlyContribution,
          lateFineRate: 5,
          quorumPercent: 60,
          maxLoanMultiple: 3,
          payoutCycle: "1st Monday",
        },
        currency: "KES",
        created_by: newUser.id,
      })
      .select()
      .single();

    if (chamaError || !chama) {
      return {
        error: chamaError?.message ?? "Failed to create chama. Please try again.",
      };
    }

    // 4. Add founder as Chairperson
    const { error: memberError } = await supabase.from("chama_members").insert({
      chama_id: chama.id,
      user_id: newUser.id,
      role: "Chairperson" as MemberRole,
      monthly_contribution: minMonthlyContribution,
      total_paid: 0,
      active_loans: 0,
      status: "active",
    });

    if (memberError) {
      return { error: memberError.message };
    }

    // Session should already be set by signUp (if email confirmation is off)
    await hydrateUser(newUser);
    return {};
  }, [hydrateUser]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setActiveChamaId(null);
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
