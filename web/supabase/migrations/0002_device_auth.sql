-- Device-based auth for the desktop app: replaces the license-key model.
--
--  * `devices`       — one row per signed-in machine (was: license_instances)
--  * `device_codes`  — one-time codes carrying a session across the
--                      browser → deep-link → app gap. PKCE-style: the app keeps
--                      a secret verifier; we store only its SHA-256 challenge,
--                      so intercepting the code is useless without the verifier.
--
-- The license tables from 0001 stay (harmless) but stop being load-bearing.

-- ---------------------------------------------------------------- devices

create table public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- From tauri-plugin-machine-uid on the desktop.
  machine_id   text not null,
  name         text not null default 'Pluely desktop',
  app_version  text,
  platform     text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- Re-signing-in on the same machine reuses the row instead of duplicating it.
  unique (user_id, machine_id)
);

create index devices_user_id_idx on public.devices (user_id);

alter table public.devices enable row level security;

create policy "devices: read own"
  on public.devices for select
  using (auth.uid() = user_id);

create policy "devices: delete own"
  on public.devices for delete
  using (auth.uid() = user_id);
-- Inserts/updates come only from the API routes (service role).

-- ------------------------------------------------------------ device_codes

create table public.device_codes (
  -- The one-time code itself, random and unguessable (server-generated).
  code        text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- SHA-256 (hex) of the app's verifier. Exchange must present the preimage.
  challenge   text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.device_codes enable row level security;
-- No policies at all: browser clients never touch this table. Only the
-- service-role API routes read or write it.

-- ------------------------------------------------------------- entitlement

-- "Is this user entitled to Pro right now?" — single source of truth for
-- /api/me and the hosted-model proxy. `past_due` counts as entitled: Stripe is
-- still dunning the card and cutting access mid-retry punishes honest users.
create or replace function public.user_is_entitled(p_user_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('trialing', 'active', 'past_due')
  );
$$;
