// ChamaVault domain types — collective savings, cashless rails & quorum governance.

export type ChamaKind = "merry-go-round" | "table-banking" | "welfare-pot" | "investment-pool";

export type MemberRole =
  | "Chairperson"
  | "Treasurer"
  | "Secretary"
  | "Active Member"
  | "New Applicant";

export type ContributionMethod = "M-Pesa STK Push" | "Bank EFT / RTGS";

export type ContributionStatus = "completed" | "pending" | "failed";

export interface Contribution {
  id: string;
  memberId: string;
  chamaId: string;
  amount: number;
  method: ContributionMethod;
  reference: string;
  status: ContributionStatus;
  date: string; // ISO
  note?: string;
}

export type VoteValue = "approve" | "reject" | "abstain";

export type ProposalStatus = "active" | "approved" | "rejected" | "disbursed" | "settled";

export interface Proposal {
  id: string;
  chamaId: string;
  type: "loan" | "withdrawal" | "payout" | "investment";
  title: string;
  amount: number;
  requesterId: string;
  reason: string;
  requestedAt: string; // ISO
  status: ProposalStatus;
  votes: Record<string, VoteValue>; // memberId -> vote
  quorumThreshold: number; // 0..1 fraction needed to execute
  guarantorIds?: string[];
  disbursedAt?: string;
  repayment?: LoanRepaymentPlan;
}

export interface LoanRepaymentPlan {
  interestRate: number; // % per schedule
  interestModel: "flat" | "reducing-balance";
  installments: number;
  schedule: LoanPayment[];
}

export interface LoanPayment {
  dueDate: string;
  amount: number;
  paid: boolean;
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  role: MemberRole;
  avatarHue: number; // 0-360 for deterministic gradient avatars
  joinedAt: string;
  monthlyContribution: number;
  totalPaid: number;
  activeLoans: number;
  isCurrentUser?: boolean;
}

export interface Chama {
  id: string;
  name: string;
  tagline: string;
  kind: ChamaKind;
  memberCount: number;
  poolBalance: number;
  monthlyTarget: number;
  monthCollected: number;
  constitution: {
    minMonthlyContribution: number;
    lateFineRate: number; // % per missed cycle
    quorumPercent: number; // e.g. 60
    maxLoanMultiple: number; // e.g. 3x own savings
    payoutCycle: string; // e.g. "1st Monday"
  };
  nextPayout: {
    recipientName: string;
    amount: number;
    dueDate: string;
  };
  currency: string; // "KES"
}

export type AuditType = "contribution" | "loan-disbursed" | "repayment" | "withdrawal" | "vote" | "penalty";

export interface AuditEvent {
  id: string;
  chamaId: string;
  memberId: string;
  type: AuditType;
  description: string;
  amount: number;
  timestamp: string; // ISO
  reference: string; // tamper-proof-ish reference like CV-2025-00042
}