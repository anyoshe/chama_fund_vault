# Money paths UAT + migration order

## Ordered SQL (run once in Supabase SQL Editor)

1. `schema.sql` (if new project)
2. `kits_full.sql`
3. `contribution_persistence.sql`
4. `phase1_contribution_plans.sql`
5. `dual_payment_modes.sql`
6. `fix_submit_pending_contribution.sql`
7. `harden_approve_pending.sql` ← approve clears obligation + kits
8. `loaning_pool.sql` / `kits_operations.sql`
9. `proposals_ledger_persistence.sql`
10. `chama_expenses_full.sql`
11. `arrears_and_fines_tracking.sql`
12. `chama_mpesa_credentials.sql`
13. `mpesa_stk_complete.sql`
14. `chamavault_health_check.sql`

Then: **Chama Finance → Run check** until green.

## UAT checklist (two browsers, same chama)

### 1. Manual contribute
- [ ] Member: Contribute → Manual → pot → amount → submit  
- [ ] Statement does **not** show it yet (pending)  
- [ ] Treasurer: Approvals → Approve  
- [ ] Kit balance up, Pool up, statement shows payment  

### 2. Obligation due
- [ ] Member sees “What I need to pay” / behind card  
- [ ] Pay now → Manual → submit  
- [ ] Treasurer approves  
- [ ] **Owe = 0**, pot credited  

### 3. Loan path
- [ ] Member requests loan (under limit)  
- [ ] Other members vote (applicant cannot vote)  
- [ ] Pending votes drop as votes land (both browsers)  
- [ ] Treasurer disburses  
- [ ] Member repays → principal/interest; kits/pool update  

### 4. Two browsers
- [ ] Same kits, pool, votes, pending approvals on both after refresh  

If any step fails, note the toast error text and which SQL health check still reports missing.
