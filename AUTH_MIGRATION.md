# Authentication Migration: License Keys → Browser Sign-In

**Date:** August 2026
**Status:** ✅ Complete — all checks passing

## What changed

The desktop app no longer uses license-key activation (checkout → email → paste key). Users now sign in through the browser, and the app receives a session via a `pluely://` deep link using a PKCE-style code exchange. Entitlement comes from the user's Stripe subscription, checked live with a 72-hour offline grace window.

## How the sign-in flow works

1. Desktop app generates a secret **verifier**, computes its SHA-256 **challenge**, and opens the browser at `/login?next=/device-success?challenge=...`
2. User signs in on the web (email/password or Google OAuth)
3. `/device-success` mints a 5-minute, single-use device code bound to the challenge and redirects to `pluely://auth?code=...`
4. The app exchanges `code + verifier` at `/api/auth/exchange` for a Supabase session
5. Intercepting the deep-link code is useless without the verifier, which never leaves the app's memory

## Expiration layers

| Layer | Lifetime | Renewal |
|---|---|---|
| Access token (JWT) | ~1 hour | Silent refresh via `/api/auth/refresh` |
| Refresh token | Until sign-out or revocation | — |
| Subscription | Stripe billing cycle | Webhook mirrors status to `subscriptions` table |
| Offline grace | 72 hours | Cached entitlement when server unreachable |

`past_due` subscriptions remain entitled during Stripe's card-retry period. The `user_is_entitled()` SQL function is the single source of truth.

## Changes by area

### Web (`web/` — Next.js + Supabase)

- **Database:** `supabase` migration `0002_device_auth.sql` — `devices` table, `device_codes` table (PKCE), `user_is_entitled()` function
- **API routes:** `/api/auth/exchange`, `/api/auth/refresh`, `/api/me` (entitlement + device heartbeat), `/api/devices/current` (self-removal on sign-out)
- **Pages:** `/device-success` (mints device code, deep-link redirect); account page now manages devices instead of licenses
- **Auth flows:** safe-redirect validation on login/signup/Google OAuth so `next=` can't be abused
- **Stripe webhook:** license provisioning removed; only mirrors subscription state
- **Removed:** legacy license API routes, `lib/license.ts`, `API_ACCESS_KEY` config

### Desktop Rust backend (`src-tauri/`)

- **New:** `src/auth.rs` — `auth_start_sign_in`, `handle_deep_link`, `auth_get_status` (auto-refresh + offline grace), `auth_sign_out`, `is_entitled_cached`, `current_access_token`
- **Config:** deep-link plugin registered for the `pluely://` scheme
- **Migrated:** `check_license_status` reads real entitlement; `get_stored_credentials` returns the access token
- **Removed:** ~380 lines of legacy license activation code from `activate.rs`

### Desktop React frontend (`src/`)

- **New:** `hooks/useAuth.ts` — auth state hook synced via `auth-changed` events
- **`GetLicense.tsx`:** rewritten as a browser sign-in button (same name/props, all 6 call sites unchanged)
- **`PluelyApiSetup.tsx`:** license-key input replaced with account display (email, plan, offline indicator, sign-out)
- **App context:** auto-refreshes entitlement; disables Pluely API on sign-out

## Setting it up yourself

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Apply both migrations in order from `web/supabase/migrations/`:
   `0001_init.sql`, then `0002_device_auth.sql` (SQL editor or `supabase db push`)
3. Enable the auth providers you want (Email is on by default; add Google under Authentication → Providers if needed)
4. Grab from Project Settings → API: the project URL, the `anon` key, and the `service_role` key

### 2. Stripe

1. Create a recurring Price for the subscription and copy its ID (`price_...`)
2. Create a webhook endpoint pointing at `<site-url>/api/stripe/webhook`, subscribed to subscription lifecycle events, and copy its signing secret (for local dev, `npm run stripe:listen` in `web/` does this via the Stripe CLI)

### 3. Web app (`web/`)

Create `web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server-only, bypasses RLS

STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...

NEXT_PUBLIC_SITE_URL=http://localhost:3000     # your public URL in production
```

Missing vars fail loudly at first use (see `web/lib/env.ts`). Then:

```bash
cd web && npm install && npm run dev
```

### 4. Desktop app

The desktop app finds the web service via `PAYMENT_ENDPOINT` — read at runtime from the environment, falling back to a compile-time value baked in with `option_env!`:

```bash
# dev: point at your local web app
PAYMENT_ENDPOINT=http://localhost:3000 npm run tauri dev

# release: bake the production URL into the binary
PAYMENT_ENDPOINT=https://your-site.com npm run tauri build
```

The `pluely://` deep-link scheme is registered by the Tauri deep-link plugin (`src-tauri/tauri.conf.json`) — no extra setup, but OS-level scheme registration only works in a **built/installed** app, not `tauri dev` on all platforms.

### 5. Try the flow

1. Start the web app, sign up, and subscribe (Stripe test card `4242 4242 4242 4242`)
2. Launch the desktop app and click **Sign in** — the browser opens
3. Sign in with the same account; the browser redirects to `pluely://auth?code=...` and hands off to the app
4. The app exchanges the code for a session; your email and plan appear under Settings → Pluely API setup

## Verification (run 2026-08-11)

| Check | Command | Result |
|---|---|---|
| Web test suite | `cd web && npm test` | ✅ `device-auth self-check passed` |
| Web typecheck | `cd web && npm run typecheck` | ✅ Clean |
| Web production build | `cd web && npm run build` | ✅ All pages built |
| Desktop typecheck | `npx tsc --noEmit` | ✅ Clean |
| Rust backend | `cd src-tauri && cargo check` | ✅ Compiles (one pre-existing `xcap` future-incompat warning, unrelated) |

## Remaining before production

- Deploy web app with real Supabase + Stripe credentials
- Apply the `0002_device_auth.sql` migration to the production database
- Test the live browser → deep-link → exchange flow on a built desktop binary
