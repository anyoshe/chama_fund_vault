import type { MemberRole, ChamaKind, ChamaActivity } from "./chama";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  email: string;
  avatar_hue: number;
  created_at: string;
}

export interface ChamaRecord {
  id: string;
  name: string;
  tagline: string;
  kind: ChamaKind;
  pool_balance: number;
  monthly_target: number;
  month_collected: number;
  constitution: {
    minMonthlyContribution: number;
    lateFineRate: number;
    quorumPercent: number;
    maxLoanMultiple: number;
    payoutCycle: string;
    activities?: ChamaActivity[];
  };
  currency: string;
  created_by: string;
  created_at: string;
}

export interface ChamaMembership {
  id: string;
  chama_id: string;
  user_id: string;
  role: MemberRole;
  monthly_contribution: number;
  total_paid: number;
  active_loans: number;
  status: "active" | "pending" | "suspended";
  joined_at: string;
  // joined
  chama?: ChamaRecord;
  profile?: Profile;
}

export interface AuthUser {
  id: string;
  email: string;
  profile: Profile | null;
  memberships: ChamaMembership[];
}

export type LoginIdentifier = string; // email or phone
