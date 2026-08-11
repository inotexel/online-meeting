# Pluely web — marketing site, accounts, billing, desktop auth API

One Next.js app serving four things that all need the same public HTTPS host:

1. **Marketing site** — `/`, `/pricing`
2. **Accounts** — Supabase auth (email/password + Google), `/login`, `/signup`, `/account`
3. **Billing** — Stripe Checkout, Customer Portal, and the webhook that is the *only*
   writer of subscription state
4. **Desktop auth API** — `/api/auth/exchange`, `/api/auth/refresh`, `/api/me`,
   `/api/devices/current`

## The model

**The desktop app holds a real user session, obtained through the system browser.**
No license keys, no shared secrets, no passwords typed into the app.

```
app "Sign in"
  → generates secret verifier, opens browser at
    /login?next=/device-success?challenge=sha256(verifier)
  → user signs in on the web (email or Google)
  → /device-success mints a one-time code (5 min, single-use, bound to challenge)
  → redirects to pluely://auth?code=...   (OS routes the deep link to the app)
  → app: POST /api/auth/exchange {code, verifier, machine_id}
  → server verifies sha256(verifier) == challenge, burns the code,
    returns a Supabase session + entitlement snapshot
```

PKCE-style: a rogue app that hijacks the `pluely://` scheme and steals the code
cannot exchange it — the verifier never left the real app's memory.

**Entitlement** is answered by `GET /api/me` (JWT bearer auth):
`{email, plan, entitled, entitled_until}`. `entitled_until` is `now + 72h` — the
offline grace window the app may honor when the server is unreachable. The SQL
function `user_is_entitled()` (migration 0002) is the single source of that
verdict; `past_due` counts as entitled while Stripe retries the card.

**Stripe is the source of truth for payment.** The webhook mirrors subscription
state into the `subscriptions` table; nothing else writes it. Anything with
marginal cost (the hosted-model proxy) must check entitlement server-side per
request — client-side checks are UX, not security (the client is GPL; anyone
can patch it).

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run dev
```

### 1. Supabase

Create a project, then run the migrations in the SQL editor, in order:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_device_auth.sql
```

Copy into `.env.local` from **Project Settings → API**:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

For Google sign-in: **Authentication → Providers → Google**, and add
`https://YOUR-PROJECT.supabase.co/auth/v1/callback` as an authorised redirect URI in
the Google Cloud console.

### 2. Stripe

Create a **recurring Price** and copy its `price_...` id to `STRIPE_PRICE_ID`.
Secret key from **Developers → API keys**.

Locally, the webhook secret comes from the CLI:

```bash
npm run stripe:listen     # prints whsec_... → STRIPE_WEBHOOK_SECRET
```

In production, add the endpoint `https://YOUR-DOMAIN/api/stripe/webhook` subscribed to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### 3. Point the desktop app here

In `src-tauri/.env`:

```
PAYMENT_ENDPOINT=https://YOUR-DOMAIN/api
```

That's the only wiring the app needs — it derives the site URL from it for the
browser sign-in hand-off.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # challenge hashing pinned against the Rust client
npm run build       # full Next build
```

## Known gaps

- **The hosted-model proxy is not in this repo.** The app's `APP_ENDPOINT` calls
  carry the session JWT now; whatever service serves them must validate it
  (Supabase JWKS) and check `user_is_entitled()` per request.
- **Deep links on Linux** depend on the `.desktop` file registering
  `x-scheme-handler/pluely`; dev builds register at runtime, but exotic setups
  may need a "paste the code" fallback (not built yet).
- **Legacy license tables** from 0001 still exist but nothing writes or reads
  them; drop them in a future migration once confident.
- **Prices are hardcoded in the pricing page copy** (`$12/month`). Stripe's
  Price is the real number; the page text must be updated by hand.
