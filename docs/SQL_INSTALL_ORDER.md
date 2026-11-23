# ChamaVault — SQL install order (clean database)

## Do I run all SQL every time I clean the database?

| What you “clean” | Re-run all SQL? |
|------------------|-----------------|
| **Delete data only** (chamas, members, contributions, loans) — tables stay | **No.** Schema and functions remain. Just create new chamas/users. |
| **Reset project / drop schema / new Supabase project** | **Yes.** Run the full ordered list once. |
| **Fix one bug / add one feature** | **No.** Run only the new or fixed `.sql` file. |

**Rule:** SQL migrations build **structure** (tables, functions, RLS).  
Cleaning **test money and members** does not remove structure.  
Only a **full wipe or new project** needs the full stack again.

After a full install, use **Chama Finance → System health → Run check** until green.

---

## Ordered list (run top → bottom in Supabase → SQL Editor)

Paste **one file at a time**. If a statement errors because “already exists”, continue unless the health check still fails.

### A. Foundation
1. `supabase/schema.sql`
2. `supabase/kits_full.sql`
3. `supabase/contribution_persistence.sql`

### B. Plans, dues, payments
4. `supabase/phase1_contribution_plans.sql`
5. `supabase/dual_payment_modes.sql`
6. `supabase/fix_submit_pending_contribution.sql`
7. `supabase/harden_approve_pending.sql`
8. `supabase/ensure_current_period_obligations.sql`
9. `supabase/pot_schedule_deadlines.sql`

### C. Loans & votes
10. `supabase/loaning_pool.sql`
11. `supabase/kits_operations.sql`
12. `supabase/proposals_ledger_persistence.sql`
13. `supabase/repay_interest_distribution.sql` (if present)
14. `supabase/fix_repay_sync_proposals.sql` (if present)

### D. Expenses, arrears, fines
15. `supabase/chama_expenses_full.sql`
16. `supabase/arrears_and_fines_tracking.sql`
17. `supabase/auto_fines_invite_mgr.sql`
18. `supabase/fix_late_fine_settings_raise.sql`
19. `supabase/treasurer_late_members.sql`

### E. Merry-go-round wheel
20. `supabase/mgr_wheel_draw.sql`
21. `supabase/phase_a_c_kits_mgr.sql` (MGR pot helpers, if not already covered)

### F. M-Pesa (optional until live STK)
22. `supabase/chama_mpesa_credentials.sql`
23. `supabase/mpesa_stk_complete.sql`
24. `supabase/fail_incomplete_stk_pending.sql`

### G. Health
25. `supabase/chamavault_health_check.sql`

### H. Only if you hit a known bug
- `supabase/fix_rls_recursion_v2.sql`
- `supabase/fix_proposals_visibility.sql`
- `supabase/fix_registration_kit_routing.sql`
- `supabase/merge_welfare_running_expenses.sql`

---

## After SQL (first real chama)

1. Deploy app with correct `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
2. Register chama → set **active pots** → **contribution plans** (due day/weekday) → **late fines**
3. Add Chair / Treasurer / Secretary
4. UAT: manual pay → approve; loan → vote → disburse → repay
5. Then open to real members (manual payments first)

You do **not** re-run this list every week—only after a full schema wipe or new project.
