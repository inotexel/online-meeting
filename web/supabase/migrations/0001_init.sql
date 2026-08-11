-- Pluely backend schema: accounts, Stripe subscriptions, licenses, machine seats.
--
-- Design notes:
--  * auth.users is owned by Supabase. `profiles` mirrors it 1:1 for app data.
--  * A license belongs to a user and is the credential the DESKTOP app holds.
--    The desktop app never sees a Supabase session — it only knows its key.
--  * license_instances enforces the seat cap: one row per activated machine.
--  * RLS is on everywhere. The desktop API routes use the service-role key and
--    bypass RLS deliberately; browser clients only ever see their own rows.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  -- Set once we create a Stripe Customer for this user. Nullable until then.
  stripe_customer_id text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever Supabase creates an auth user, so the app
-- never has to handle a signed-in user with no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------- subscriptions

-- Mirrors the Stripe subscription. Stripe remains the source of truth; this is
-- a read cache so we can answer "is this user paid?" without an API round-trip.
create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete',
  'incomplete_expired', 'unpaid', 'paused'
);

create table public.subscriptions (
  id                     text primary key,            -- Stripe subscription id
  user_id                uuid not null references public.profiles (id) on delete cascade,
  status                 public.subscription_status not null,
  price_id               text not null,
  quantity               integer not null default 1,
  cancel_at_period_end   boolean not null default false,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions: read own"
  on public.subscriptions for select
  using (auth.uid() = user_id);
-- No insert/update/delete policy: only the webhook (service role) writes here.

-- ---------------------------------------------------------------- licenses

create table public.licenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- The key the desktop app stores. Format: PLY-XXXX-XXXX-XXXX-XXXX
  key          text not null unique,
  -- Null for a license not tied to a subscription (dev/comp licenses).
  subscription_id text references public.subscriptions (id) on delete set null,
  -- How many distinct machines may hold this license at once.
  seat_limit   integer not null default 3 check (seat_limit > 0),
  is_dev       boolean not null default false,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index licenses_user_id_idx on public.licenses (user_id);

alter table public.licenses enable row level security;

create policy "licenses: read own"
  on public.licenses for select
  using (auth.uid() = user_id);

-- -------------------------------------------------------- license_instances

-- One row per machine that has activated a license. `machine_id` comes from the
-- desktop app's tauri-plugin-machine-uid.
create table public.license_instances (
  id          uuid primary key default gen_random_uuid(),
  license_id  uuid not null references public.licenses (id) on delete cascade,
  machine_id  text not null,
  name        text not null,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  -- A machine occupies exactly one seat per license, so re-activating from the
  -- same machine is idempotent rather than burning a second seat.
  unique (license_id, machine_id)
);

create index license_instances_license_id_idx on public.license_instances (license_id);

alter table public.license_instances enable row level security;

create policy "license_instances: read own"
  on public.license_instances for select
  using (
    exists (
      select 1 from public.licenses l
      where l.id = license_instances.license_id and l.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------ helpers

-- Single source of truth for "may this license run the app right now?".
-- Used by /api/activate and /api/validate.
create or replace function public.license_is_entitled(p_license_id uuid)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select
    l.revoked_at is null
    and (
      l.is_dev
      or exists (
        select 1 from public.subscriptions s
        where s.id = l.subscription_id
          and s.status in ('trialing', 'active')
          -- Grace period: Stripe can lag on renewal, so trust status over date
          -- unless the period ended more than a day ago.
          and (s.current_period_end is null or s.current_period_end > now() - interval '1 day')
      )
    )
  from public.licenses l
  where l.id = p_license_id;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();
