-- Surco licensing schema for Neon (Postgres). Run once against the database, e.g.
--   psql "$DATABASE_URL" -f apps/web/db/schema.sql
-- Two tables: one row per sold license, one row per device that activated it.

create extension if not exists pgcrypto;

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  -- The key the customer pastes into the app, e.g. SURCO-XXXX-XXXX-XXXX-XXXX.
  license_key text unique not null,
  email text not null,
  -- active → grants Pro. refunded/revoked → the app downgrades on next validate.
  status text not null default 'active',
  -- Devices this key may run on at once; activations beyond it are refused.
  max_activations int not null default 3,
  -- Stripe provenance, kept for support, dedupe (one license per session) and refunds.
  stripe_session_id text unique,
  stripe_customer_id text,
  stripe_payment_intent text,
  created_at timestamptz not null default now()
);

create table if not exists activations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  -- The desktop install's stable device id (settings.deviceId).
  device_id text not null,
  device_name text,
  platform text,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Re-activating the same device is idempotent rather than a second seat.
  unique (license_id, device_id)
);

create index if not exists activations_license_idx on activations (license_id);
create index if not exists licenses_email_idx on licenses (lower(email));
