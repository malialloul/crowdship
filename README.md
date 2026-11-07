# Crowdship — Sprint 1

People in Lebanon order items from abroad; travelers flying into Beirut carry them. Money sits in Whish escrow until the handover.

**Sprint 1 scope:** phone / Google sign-in, ID verification with admin review, and the Whish escrow state machine (hold → release).

Stack: React 19 + TypeScript + Vite, Tailwind CSS v4, Supabase (Postgres, Auth, Storage, Edge Functions).

---

## Acceptance criteria → where it lives

| Story | AC | Implementation |
|---|---|---|
| 1.1 | Phone OTP (+961 and international) and Google sign-in | `src/pages/LoginPage.tsx`, `src/lib/phone.ts` (accepts `03 123 456`, `71-123-456`, `+971…`, `00961…`) |
| 1.1 | Upload profile picture and ID / passport | `src/pages/ProfilePage.tsx` → `avatars` (public) and `kyc-documents` (private) buckets; `submit_kyc()` |
| 1.1 | "Pending Verification" badge until admin approves | `profiles.kyc_status`, `VerificationBadge`, admin review at `/admin/kyc` → `review_kyc()` |
| 1.2 | Whish payment request when an offer is accepted | `escrow` Edge Function, action `create_hold`; frontend `startPaymentHold()` (Sprint 2 calls it from "accept offer") |
| 1.2 | Funds move to `HELD` in the state machine | `escrow_transition()` in SQL, called by the Whish callback / action `verify` after Whish confirms |
| 1.2 | Admin or API hook to `RELEASE` | `escrow` action `release` (admin), `/admin/escrow`; Sprint 3 OTP adds an action that calls `transition(…, 'RELEASED')` with method `otp` |

## Escrow state machine

```
PENDING_PAYMENT ──► HELD ──► RELEASED   (payout queued for traveler)
       │              └────► REFUNDED   (Sprint 4 disputes)
       ├──► FAILED
       └──► CANCELLED
```

Enforced in Postgres twice: `escrow_transition()` checks the move, and a trigger rejects illegal status changes and any change to amounts or parties, even from the service role. Every change is logged in `escrow_events`. Transitions are idempotent, so duplicate Whish callbacks are harmless.

## Project layout

```
supabase/
  migrations/   profiles + KYC + storage, escrow + payouts
  functions/    escrow/ — one function: create_hold, verify, release + Whish callback
  tests/        sprint1.sql — 32 checks for RLS, KYC and escrow rules
  config.toml   local auth (test OTP numbers), Google, Edge Function JWT settings
src/
  auth/         session + profile context
  services/     profile/KYC and escrow calls
  pages/        login, profile, payments, Whish return, mock checkout, admin
```

---

## Run it locally

Needs Node 20+, Docker, and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
npm install
supabase start                      # prints API URL + anon key
supabase db reset                   # applies migrations

cp .env.example .env.local          # paste the URL + anon key
cp supabase/functions/.env.example supabase/functions/.env
npm run functions:serve             # terminal 2
npm run dev                         # terminal 3 → http://localhost:5173
```

`WHISH_MODE=mock` (the default in `.env.example`) sends you to a local test checkout instead of Whish, so the full flow works without merchant credentials.

### Try the whole flow

1. Sign in with `+961 70 000 001`, code `123456` (test numbers are in `config.toml`, no SMS is sent).
2. Make that account an admin in Studio (http://localhost:54323) → SQL editor:
   ```sql
   update public.profiles set role = 'admin' where phone = '+96170000001';
   ```
3. Upload any ID photo on the profile page (front and back), then refresh: the badge reads **Pending Verification**.
4. In a private window sign in as `+961 70 000 002` (the traveler), upload an ID, and copy its user ID from the profile header.
5. Back as admin: **ID reviews** → approve both submissions.
6. As the shopper: **Payments** → *Start a test hold*, paste the traveler's ID → *Pay with Whish* → *Approve payment*. Status becomes **Held in escrow**.
7. As admin: **Escrow** → *Release to traveler*. A payout appears under *Payouts to send*.

Database tests:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/sprint1.sql
```

---

## Going live

### Supabase project

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set --env-file supabase/functions/.env   # with WHISH_MODE=live
supabase functions deploy escrow --no-verify-jwt
```

In the Dashboard:

- **Auth → URL configuration:** Site URL = your app URL; add `https://<app>/auth/callback` to redirect URLs.
- **Auth → Providers → Phone:** enable, pick Twilio Verify (or another provider). In Twilio, allow SMS to Lebanon (+961) and the diaspora countries you expect under Geo Permissions. For a local Lebanese SMS gateway, use Supabase's *Send SMS hook* instead.
- **Auth → Providers → Google:** (locally: set `enabled = true` in `config.toml` and put the keys in `supabase/.env`) create an OAuth client in Google Cloud, authorised redirect URI `https://<ref>.supabase.co/auth/v1/callback`.
- Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` on your frontend host (Vercel, Netlify, Cloudflare Pages) and add an SPA fallback to `index.html`.

### Whish Pay

1. Get a Whish Pay merchant account; Whish issues `channel`, `secret` and `websiteUrl`.
2. Set `WHISH_MODE=live`, `WHISH_BASE_URL` (sandbox first: `https://lb.sandbox.whish.money/itel-service/api`), and the three credentials.
3. In sandbox, pay with phone `96170902894` and OTP `111111`.
4. Switch `WHISH_BASE_URL` to `https://whish.money/itel-service/api` for production.

The Whish client in `supabase/functions/escrow/index.ts` uses `POST /payment/whish` (returns `collectUrl`) and `POST /payment/collect/status` (returns `collectStatus`). These endpoints come from an existing community integration, not official public docs, so check them against the documentation Whish sends with your credentials.

**Payouts:** Whish Pay's merchant API collects payments. It has no documented endpoint to send money to a traveler's wallet, so releasing a hold creates a `payouts` row. The admin sends the transfer from the Whish business account and clicks *Mark as paid* with the Whish reference. If Whish gives you a disbursement API, call it in the `release` action after the transition.

**Before launch:** taking customer funds and paying them out later may need regulatory approval in Lebanon (Banque du Liban rules on e-money and payment services). Confirm the arrangement with Whish and a local lawyer.

---

## Security notes

- Users can edit only `full_name`, `avatar_url` and `whish_phone` on their profile (column grants). Role and KYC status change only through `review_kyc()` (admins).
- KYC files are private, stored under `{user_id}/`, readable by the owner and admins (5-minute signed URLs), and can't be overwritten or deleted.
- Escrow, events and payouts are read-only to users (RLS: shopper, traveler or admin). Only the service role can call `escrow_transition()`.
- The Whish redirect and callback are hints only. Status always comes from Whish's status API. The callback URL carries an HMAC token.
- The `escrow` function runs with gateway JWT checks off (Whish can't send one) and checks the session itself on every user action.
- `WHISH_MODE` has no default; the functions refuse to run until it's set. Mock mode lets the shopper approve their own payment, so it must never reach production.
- Both shopper and traveler need a Verified badge before a hold can start.

## Hooking into Sprint 2

- Add `alter table escrow_transactions add foreign key (order_id) references orders(id);`
- When the shopper accepts an offer: set the order to `AWAITING_PAYMENT_HOLD`, call `startPaymentHold({ order_id, traveler_id, item_amount, reward_amount, currency })`, then `window.location.assign(collect_url)`.
- Move the amount calculation into the `create_hold` action (read it from the accepted offer by `order_id`) so the browser no longer sends amounts. The *Start a test hold* form on `/payments` can then go.
- Regenerate types with `npm run db:types`.
