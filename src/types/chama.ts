// ChamaVault domain types — collective savings, cashless rails & quorum governance.

/** Primary display kind (legacy + hybrid). Prefer `activities` for full multi-select. */
export type ChamaKind =
  | "merry-go-round"
  | "table-banking"
  | "welfare-pot"
  | "investment-pool"
  | "hybrid";

/** What the chama actually does — multi-select at registration. */
export type ChamaActivity =
  | "merry-go-round"
  | "table-banking"
  | "member-loans"
  | "welfare"
  | "investment-pool"
  | "housing-project"
  | "education-fund"
  | "agribusiness"
  | "share-capital"
  | "general-savings";

export const CHAMA_ACTIVITIES: {
  value: ChamaActivity;
  label: string;
  desc: string;
}[] = [
  {
    value: "merry-go-round",
    label: "Merry-go-round",
    desc: "Rotating lump-sum payouts (ROSCA)",
  },
  {
    value: "table-banking",
    label: "Table banking",
    desc: "Pool savings and lend from the table",
  },
  {
    value: "member-loans",
    label: "Member loans",
    desc: "Loans among members with interest & guarantors",
  },
  {
    value: "welfare",
    label: "Welfare / emergency",
    desc: "Bereavement, medical and social support",
  },
  {
    value: "investment-pool",
    label: "Investment pool",
    desc: "Group investments in assets or businesses",
  },
  {
    value: "housing-project",
    label: "Housing / property",
    desc: "Land, housing or rental projects",
  },
  {
    value: "education-fund",
    label: "Education fund",
    desc: "School fees and education support",
  },
  {
    value: "agribusiness",
    label: "Agribusiness",
    desc: "Farming or agribusiness collective",
  },
  {
    value: "share-capital",
    label: "Share capital & dividends",
    desc: "Buy shares in the group and earn dividends",
  },
  {
    value: "general-savings",
    label: "General savings",
    desc: "Flexible savings pot without a fixed model",
  },
];

export type MemberRole =
  | "Chairperson"
  | "Treasurer"
  | "Secretary"
  | "Active Member"
  | "New Applicant";

export interface ChamaKit {
  id: string;
  chama_id: string;
  kit_code: string;
  label: string;
  balance: number;
  is_loan_fund: boolean;
  counts_toward_loan_limit: boolean;
}

export type ContributionMethod =
  | "M-Pesa STK Push"
  | "Airtel Money"
  | "Bank EFT / RTGS"
  | "PesaLink"
  | "Other";

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
  destination?: ChamaActivity;
  paymentDetails?: string;
  confirmedAt?: string;
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
  /** Multi-select activities chosen at registration */
  activities?: ChamaActivity[];
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
    activities?: ChamaActivity[];
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