-- Tamzit app: schema of the app_ tables (tables, constraints, indexes).
-- Every object is prefixed with app_. Editions, stories and profiles live in the project's existing tables
-- (tamzit_editions, tamzit_edition_elements, processed_stories, user_preferences): see 0008 / 0009.
-- The first version also created app_items, app_item_versions, app_editions, app_edition_items, app_audio,
-- app_ads and app_profiles; 0008 dropped them and they are no longer created here.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create or replace function public.app_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- critical = 3, important = 2, general = 1 (also used for the profile level_filter)
create or replace function public.app_level_rank(p_level text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_level when 'critical' then 3 when 'important' then 2 when 'general' then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- Reference content (written by the engine / seed)
-- ---------------------------------------------------------------------------

create table if not exists public.app_topics (
  id          text primary key,
  name_he     text not null,
  name_en     text not null,
  name_fr     text not null,
  sort        int not null default 0,
  is_default  boolean not null default false,
  active      boolean not null default true
);

create table if not exists public.app_cities (
  id              text primary key,
  name_he         text not null,
  name_en         text not null,
  name_fr         text not null,
  lat             double precision not null,
  lon             double precision not null,
  tzid            text not null default 'Asia/Jerusalem',
  in_israel       boolean not null default true,
  candle_minutes  int not null default 20 check (candle_minutes between 0 and 90),
  sort            int not null default 0,
  active          boolean not null default true
);

create table if not exists public.app_communities (
  id              text primary key,
  name_he         text not null,
  name_en         text not null,
  name_fr         text not null,
  description_he  text,
  description_en  text,
  description_fr  text,
  city_id         text references public.app_cities(id) on delete set null,
  sort            int not null default 0,
  active          boolean not null default true
);

create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null
);

-- ---------------------------------------------------------------------------
-- Users (written by the app through RLS / RPCs, and by the edge functions)
-- ---------------------------------------------------------------------------

create table if not exists public.app_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  plan        text not null check (plan in ('premium', 'family')),
  source      text not null check (source in ('whatsapp', 'app_store', 'google_play', 'manual')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  external_ref text,                    -- store / WhatsApp system reference (optional)
  created_at  timestamptz not null default now()
);
create index if not exists app_subscriptions_phone_idx on public.app_subscriptions (phone);

create table if not exists public.app_family_members (
  owner_id      uuid not null,                 -- -> user_preferences(user_id), FK added in 0008
  member_phone  text not null check (member_phone ~ '^\+[1-9][0-9]{6,14}$'),
  member_name   text,
  status        text not null default 'invited' check (status in ('invited', 'joined', 'removed')),
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  primary key (owner_id, member_phone)
);
create index if not exists app_family_members_phone_idx on public.app_family_members (member_phone);

create table if not exists public.app_saved_items (
  profile_id  uuid not null default auth.uid(),
  item_id     text not null,                 -- 's<story id>' or 'e<edition id>-<n>'
  created_at  timestamptz not null default now(),
  primary key (profile_id, item_id)
);

create table if not exists public.app_reads (
  profile_id   uuid not null default auth.uid(),
  edition_key  text not null check (length(edition_key) between 1 and 100),
  read_at      timestamptz not null default now(),
  primary key (profile_id, edition_key)
);

create table if not exists public.app_feedback (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid(),
  item_id     text,
  kind        text not null check (kind in ('helpful', 'not_helpful', 'error', 'question')),
  message     text check (message is null or length(message) <= 4000),
  status      text not null default 'new' check (status in ('new', 'seen', 'replied', 'closed')),
  reply       text,
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists app_feedback_profile_idx on public.app_feedback (profile_id, created_at desc);
create index if not exists app_feedback_status_idx on public.app_feedback (status, created_at desc);

create table if not exists public.app_messages (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null,
  title       text not null,
  body        text not null,
  item_id     text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists app_messages_profile_idx on public.app_messages (profile_id, created_at desc);

create table if not exists public.app_devices (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null default auth.uid(),
  push_token    text not null unique,
  platform      text not null check (platform in ('android', 'ios')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists app_devices_profile_idx on public.app_devices (profile_id);

create table if not exists public.app_donations (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid(),
  amount      numeric(12, 2) not null check (amount > 0),
  currency    text not null default 'ILS',
  frequency   text not null check (frequency in ('once', 'monthly')),
  status      text not null default 'initiated',
  created_at  timestamptz not null default now()
);

-- Edge functions only ------------------------------------------------------

create table if not exists public.app_pending_registrations (
  phone       text primary key,
  full_name   text not null,
  email       text not null,
  birth_year  int,
  city        text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 minutes'
);

create table if not exists public.app_login_attempts (
  id          bigserial primary key,
  phone       text not null,
  kind        text not null default 'start' check (kind in ('start', 'verify')),
  created_at  timestamptz not null default now(),
  success     boolean not null default false
);
create index if not exists app_login_attempts_phone_idx on public.app_login_attempts (phone, kind, created_at desc);

-- One-time 6-digit codes issued by app-auth-start (hashed; 10 minutes).
create table if not exists public.app_login_codes (
  phone       text primary key,
  email       text not null,
  mode        text not null check (mode in ('register', 'login')),
  code_hash   text not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);
