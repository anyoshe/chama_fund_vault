# ChamaVault — Go-live (only M-Pesa left in product code)

## You must run on Supabase

1. `supabase/proposals_ledger_persistence.sql` (done if already applied)
2. **`supabase/go_live_remaining.sql`** ← fines, invites redeem, notifications, merry-go-round

## Deploy (operator)

1. Connect GitHub repo to Vercel/Netlify
2. Set env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPPORT_EMAIL`
3. Domain + HTTPS
4. Supabase Auth → Site URL = your domain; enable email; optional SMTP
5. Database backups in Supabase dashboard

## Product complete (non-M-Pesa)

- Server proposals / votes / audit
- Invite codes: Members → Generate invite · public `/join`
- Cycle close + auto fines (Chama Finance)
- Merry-go-round advance (Chama Finance)
- In-app notifications table + bell
- Error boundary, package name `chamavault`
- Legal pages, statement CSV
- Loan rules, kits, roles, My Finance / Chama Finance

## Still only M-Pesa / live rails

- Set `VITE_PAYMENT_MODE=live` after Daraja Edge Function is implemented
- Until then `recorded` mode is intentional for pilot

## Support line in app

Set `VITE_SUPPORT_EMAIL` / `VITE_SUPPORT_PHONE` for footer and error screen.

## Phase A–C kits (after go_live_remaining)
Run: supabase/phase_a_c_kits_mgr.sql
- registration-fees, contingency kits
- contingency campaigns
- record_expense_from_kit
- mgr_payout


## Phase D–E
Run: supabase/phase_d_e_locks_contingency.sql
- share withdrawal requests + locks
- close contingency campaign
- chair share lock settings

