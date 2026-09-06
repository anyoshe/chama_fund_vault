# ChamaVault — Phase 1 Setup (Multi-tenant ERP)

## What’s new

- Public landing page
- **Register a Chama** (creates admin account + organization)
- **Login** with **email or phone number** + password
- Protected dashboard
- **Members** tab: list users and create credentials for new members
- Brand colors preserved (slate-950 + emerald/teal)

## 1. Create a Supabase project

1. Go to [https://supabase.com](https://supabase.com) → New project  
2. Copy **Project URL** and **anon public** key  

## 2. Run the database schema

In Supabase → **SQL Editor** → New query → paste and run:

`supabase/schema.sql`

If the project already contains duplicate chamas from earlier signup retries, run
`supabase/fix_duplicate_chamas.sql` first. It keeps the oldest chama for each
owner/name pair and prevents future duplicates.

For durable contribution records, run `supabase/contribution_persistence.sql`
after the schema. It creates the contribution audit table and an atomic RPC that
records a confirmed payment while updating the member standing and chama pool.

## 3. Auth settings

Supabase Dashboard → **Authentication** → **Providers**:

- Enable **Email**
- For development: turn **off** “Confirm email”  
  (otherwise new accounts cannot sign in until they click the email link)

## 4. Local environment

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## 5. Install & run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## User flows

| Action | Path |
|--------|------|
| Landing | `/` |
| Create chama + admin account | `/register` |
| Sign in (email **or** phone + password) | `/login` |
| App (protected) | `/app` |
| Members list & add credentials | App → **Members** tab |

### Login with phone

Phone is stored on `profiles`. At login:

1. If the identifier looks like a phone number, we look up the matching profile  
2. Use the linked email + password with Supabase Auth  

Always collect a real email at registration (required by Supabase password auth).

### Adding members

Each account may create or join multiple chamas. A creator cannot create the same chama name twice, but can create another chama with a different name. The chama switcher only lists chamas that the signed-in account belongs to, and member profiles are loaded for the currently selected chama.

Chairperson / Secretary can open **Members → Add member**, enter the member's name, optional email, phone number, temporary password and role. Members sign in with their phone number and password; an internal email is generated only when no email is provided because Supabase password authentication requires one.

For this browser-based member creation flow, turn off **Confirm email** in Supabase Authentication settings. This lets the new member sign in immediately without needing an email inbox.

> **Note:** Creating a user from the browser uses `signUp`, which may briefly switch the browser session to the new user. For production, move member creation to a Supabase Edge Function using the **service role** key so the admin stays logged in.

## Brand

- Background: `slate-950` / `slate-900`
- Accent: `emerald-400` / `emerald-500` → `teal-600` gradients
- Borders: `slate-700` / `slate-800`

## Next phases (suggested)

- Wire proposals / ledger to Supabase tables
- Invite links instead of temporary passwords  
- Edge Function for admin-safe member creation  
- M-Pesa STK integration  
