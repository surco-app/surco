# Surco Freemium licensing

The whole monetization system is built and wired but **dormant behind a beta flag**.
While the beta is on, the desktop app treats everyone as Pro (no limits, no paywall) and
the website shows the freemium pricing with Pro free. Flipping the flag off turns on the
free-tier limits, the Pro feature gates, and live Stripe checkout — no code changes.

## Model

- **One-time license** (`mode: payment`), €29 — `PRO_PRICE_EUR` (desktop, web, API all read
  a mirror of this).
- **Free tier:** unlimited single-track conversions up to **10 per calendar month**;
  Discogs tagging and analysis included.
- **Pro unlocks:** unlimited conversions, **Convert all** (batch), and **rekordbox/Traktor
  export**.
- **3 device activations** per license (`MAX_ACTIVATIONS`).

## Pieces

- Desktop entitlement/metering logic + flag: `apps/desktop/src/shared/license.ts`
  (`BETA_MODE`, env override `SURCO_BETA=0`). License client: `apps/desktop/src/main/license.ts`.
- Web pricing + flag: `apps/web/src/config.ts` (`BETA_MODE`, env override `VITE_SURCO_BETA=0`).
- Serverless API (Vercel, Node): `apps/web/api/`
  - `checkout` / `buy` → create Stripe Checkout (web button / desktop link).
  - `webhook` → mint + store + email license on payment; mark refunded on refund.
  - `activate` / `validate` / `deactivate` → device seat management.
  - `license` → return the key for a paid session (the `/success` page).
  - `recover` → re-email a buyer's keys.
- Database schema (Neon Postgres): `apps/web/db/schema.sql`.

## Go-live checklist

1. **Neon:** create a database, run `psql "$DATABASE_URL" -f apps/web/db/schema.sql`.
2. **Stripe:** add a webhook to `https://<site>/api/webhook` for `checkout.session.completed`
   and `charge.refunded`; copy its signing secret.
3. **Vercel env:** set the variables from `.env.example` (DATABASE_URL, STRIPE_SECRET_KEY,
   STRIPE_WEBHOOK_SECRET, and optionally RESEND_API_KEY for email).
4. **Flip the flag:** set `VITE_SURCO_BETA=0` (web) and ship a desktop build with
   `SURCO_BETA=0`. From then on the limits, gates and checkout are live.
