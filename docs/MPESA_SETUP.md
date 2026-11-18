# M-Pesa STK Push setup (Safaricom Daraja)

Once credentials are in Supabase, members can pay with STK and pots update on callback.

## 1. Safaricom Daraja portal

1. Create an app at [developer.safaricom.co.ke](https://developer.safaricom.co.ke)
2. Enable **Lipa Na M-Pesa Online** (STK Push)
3. Note:
   - Consumer Key
   - Consumer Secret
   - Passkey
   - Business Shortcode (Paybill or Till)
4. Use **sandbox** first, then production

## 2. Deploy Edge Functions

From the project root (with [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy mpesa-stk-push
supabase functions deploy mpesa-callback
```

## 3. Set secrets

```bash
supabase secrets set MPESA_CONSUMER_KEY=your_key
supabase secrets set MPESA_CONSUMER_SECRET=your_secret
supabase secrets set MPESA_PASSKEY=your_passkey
supabase secrets set MPESA_SHORTCODE=your_paybill_or_till
supabase secrets set MPESA_ENV=sandbox
supabase secrets set MPESA_CALLBACK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/mpesa-callback
```

Also ensure `SUPABASE_SERVICE_ROLE_KEY` is available to functions (CLI usually injects it).

## 4. SQL

In Supabase SQL Editor run:

1. `supabase/dual_payment_modes.sql`
2. `supabase/mpesa_stk_complete.sql`

## 5. In the app

**Chama Finance → How members pay**

- `manual_confirm` — pay till/cash → record → treasurer **Approves**
- `mpesa_stk` — STK only
- `both` — member chooses

Set **Pay to** label for manual mode (e.g. Till 123456).

## 6. Flow

| Mode | Member | Ledger |
|------|--------|--------|
| Manual | Pays offline, enters pot/amount/ref | Updates only after treasurer **Approve** |
| STK | Phone PIN prompt | Updates when Safaricom callback succeeds |

No payment should credit pots without one of these paths.
