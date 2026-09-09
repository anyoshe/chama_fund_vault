# ChamaVault — Go-live checklist

## 1. Database (Supabase SQL Editor — run in order)

1. `supabase/schema.sql` (base)
2. Kits + loaning + repay scripts already used in development
3. **`supabase/proposals_ledger_persistence.sql`** ← required for multi-device loans/votes
4. Confirm Email provider + (optional) custom SMTP (Resend)

## 2. Environment

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_or_publishable_key
VITE_PAYMENT_MODE=recorded
# When Daraja Edge Function is live:
# VITE_PAYMENT_MODE=live
# VITE_PAYMENTS_API_URL=https://YOUR_PROJECT.supabase.co/functions/v1/payments
```

Never put `service_role` in the frontend.

## 3. Auth

- [ ] Email provider enabled
- [ ] Confirm email ON for production (or custom SMTP)
- [ ] Site URL + redirect URLs set to your domain
- [ ] Password recovery tested

## 4. App host

- [ ] Deploy frontend (Vercel / Netlify / Cloudflare Pages)
- [ ] Custom domain + HTTPS
- [ ] `index.html` meta/OG images point at production URL

## 5. Payments

- [ ] Pilot: `VITE_PAYMENT_MODE=recorded` (treasurer-confirmed entries)
- [ ] Production money: Safaricom Daraja app, STK callback Edge Function, then `live`

## 6. Functional UAT (one real chama)

- [ ] Register chama + add members
- [ ] Contribute to kits
- [ ] Loan request → others vote (applicant cannot vote)
- [ ] Treasurer disburses → kits drop
- [ ] Member repays → kits restore + interest split
- [ ] Second loan blocked until settle
- [ ] My Finance / Chama Finance roles
- [ ] Sign out / other device sees same proposals (after SQL applied)

## 7. Legal & ops

- [ ] `/legal/terms` and `/legal/privacy` reviewed
- [ ] Support contact published
- [ ] Database backup schedule

## 8. Known pilot limitations

- STK is not live until Daraja is wired
- Invite codes RPC exists; UI can be expanded later
- Fines auto-posting is still partial (rate shown; full cycle job TBD)
