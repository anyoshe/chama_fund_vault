/** Maps missing RPC/table names → SQL file to run in Supabase */

export type HealthResult = {
  ok: boolean;
  functionsPresent?: string[];
  functionsMissing?: string[];
  tablesMissing?: string[];
  checkedAt?: string;
  hint?: string;
};

export const RPC_TO_SQL: Record<string, { file: string; purpose: string }> = {
  submit_pending_contribution: {
    file: "dual_payment_modes.sql + fix_submit_pending_contribution.sql",
    purpose: "Manual pay → pending until treasurer approves",
  },
  approve_pending_contribution: {
    file: "dual_payment_modes.sql",
    purpose: "Treasurer approves manual payment → pots update",
  },
  reject_pending_contribution: {
    file: "dual_payment_modes.sql",
    purpose: "Treasurer rejects manual payment",
  },
  list_pending_contributions: {
    file: "dual_payment_modes.sql",
    purpose: "List payments waiting approval",
  },
  pay_contribution_obligation: {
    file: "phase1_contribution_plans.sql + fix_registration_kit_routing.sql",
    purpose: "Pay a due / obligation into the right pot",
  },
  list_my_obligations: {
    file: "phase1_contribution_plans.sql",
    purpose: "Member “What I owe” list",
  },
  list_my_payment_dues: {
    file: "arrears_and_fines_tracking.sql",
    purpose: "Behind payments + fines total",
  },
  generate_plan_obligations: {
    file: "phase1_contribution_plans.sql",
    purpose: "Generate dues for a period",
  },
  backfill_obligations_from_join: {
    file: "arrears_and_fines_tracking.sql",
    purpose: "Dues from member join date",
  },
  assess_late_fines_for_chama: {
    file: "arrears_and_fines_tracking.sql",
    purpose: "Late fines under Welfare · fines",
  },
  upsert_contribution_plan: {
    file: "phase1_contribution_plans.sql",
    purpose: "Chair creates contribution plans",
  },
  disburse_from_loan_fund: {
    file: "loaning_pool.sql / kits_operations.sql",
    purpose: "Treasurer disburses approved loan",
  },
  repay_loan: {
    file: "loaning_pool.sql / kits_operations.sql",
    purpose: "Loan repayment + interest split",
  },
  get_member_loan_limit: {
    file: "loaning_pool.sql / kits_operations.sql",
    purpose: "Borrow limit from shares",
  },
  create_chama_with_founder: {
    file: "schema.sql / phase1 auth SQL",
    purpose: "Register new chama",
  },
  list_chama_members: {
    file: "schema.sql",
    purpose: "Member list",
  },
  list_chama_kits: {
    file: "kits_full.sql",
    purpose: "Kit balances",
  },
  list_member_kit_balances: {
    file: "kits_full.sql",
    purpose: "Per-member pot balances",
  },
  upsert_chama_mpesa_credentials: {
    file: "chama_mpesa_credentials.sql",
    purpose: "Save Daraja keys in Settings",
  },
  get_chama_mpesa_status: {
    file: "chama_mpesa_credentials.sql",
    purpose: "Show if M-Pesa is configured",
  },
  get_chama_mpesa_credentials_internal: {
    file: "chama_mpesa_credentials.sql",
    purpose: "Edge Function reads M-Pesa keys",
  },
  set_chama_payment_mode: {
    file: "dual_payment_modes.sql",
    purpose: "Manual / M-Pesa / both",
  },
  record_group_expense: {
    file: "chama_expenses_full.sql",
    purpose: "Record expense from a pot",
  },
  reallocate_contribution: {
    file: "reallocate_contribution.sql",
    purpose: "Move payment to correct kit (officials)",
  },
  notify_loan_proposed: {
    file: "proposals_ledger_persistence.sql (or notify SQL)",
    purpose: "Notify members of new loan vote",
  },
};

export const TABLE_TO_SQL: Record<string, string> = {
  contribution_plans: "phase1_contribution_plans.sql",
  contribution_obligations: "phase1_contribution_plans.sql",
  member_penalties: "arrears_and_fines_tracking.sql",
  chama_mpesa_credentials: "chama_mpesa_credentials.sql",
  mpesa_stk_requests: "mpesa_stk_complete.sql",
  chama_kits: "kits_full.sql",
  member_kit_balances: "kits_full.sql",
  proposals: "proposals_ledger_persistence.sql",
};

/** Ordered recommended run list for a fresh project */
export const ORDERED_SQL_FILES = [
  "schema.sql (base)",
  "kits_full.sql",
  "contribution_persistence.sql",
  "phase1_contribution_plans.sql",
  "dual_payment_modes.sql",
  "fix_submit_pending_contribution.sql",
  "harden_approve_pending.sql",
  "loaning_pool.sql / kits_operations.sql",
  "proposals_ledger_persistence.sql",
  "chama_expenses_full.sql",
  "arrears_and_fines_tracking.sql",
  "ensure_current_period_obligations.sql",
  "pot_schedule_deadlines.sql",
  "auto_fines_invite_mgr.sql",
  "fix_late_fine_settings_raise.sql",
  "mgr_wheel_draw.sql",
  "treasurer_late_members.sql",
  "chama_mpesa_credentials.sql",
  "mpesa_stk_complete.sql",
  "chamavault_health_check.sql",
];
