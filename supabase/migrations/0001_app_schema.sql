-- Tamzit app: schema (tables, constraints, indexes, updated_at triggers).
-- Every object is prefixed with app_. The project also holds unrelated tmz_* objects: never touch them.
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

-- ---------------------------------------------------------------------------
-- News content (written by the engine with the service-role key)
-- ---------------------------------------------------------------------------

create table if not exists public.app_items (
  id            uuid primary key default gen_random_uuid(),
  external_id   text unique,
  topic_id      text references public.app_topics(id) on delete set null,
  level         text not null default 'general' check (level in ('critical', 'important', 'general')),
  kind          text not null default 'news' check (kind in ('news', 'good_news', 'community')),
  community_id  text references public.app_communities(id) on delete set null,
  published_at  timestamptz not null default now(),
  status        text not null default 'published' check (status in ('draft', 'published', 'retracted')),
  corrected_at  timestamptz,
  source_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists app_items_published_at_idx on public.app_items (published_at desc);
create index if not exists app_items_kind_published_idx on public.app_items (kind, published_at desc);
create index if not exists app_items_community_idx on public.app_items (community_id, published_at desc) where community_id is not null;
create index if not exists app_items_topic_idx on public.app_items (topic_id);

create table if not exists public.app_item_versions (
  item_id     uuid not null references public.app_items(id) on delete cascade,
  language    text not null check (language in ('he', 'en', 'fr')),
  audience    text not null default 'general' check (audience in ('general', 'youth')),
  style       text not null default 'informative' check (style in ('calm', 'human', 'informative', 'light')),
  headline    text not null,
  body        text not null,
  updated_at  timestamptz not null default now(),
  primary key (item_id, language, audience, style)
);
create index if not exists app_item_versions_lang_idx on public.app_item_versions (language, audience);

create table if not exists public.app_editions (
  id            uuid primary key default gen_random_uuid(),
  external_id   text unique,
  edition_type  text not null check (edition_type in ('morning', 'noon', 'evening', 'erev_shabbat', 'motzash', 'special')),
  language      text not null default 'he' check (language in ('he', 'en', 'fr')),
  audience      text not null default 'general' check (audience in ('general', 'youth')),
  published_at  timestamptz not null default now(),
  title         text,
  status        text not null default 'published' check (status in ('draft', 'published')),
  pushed_at     timestamptz,           -- set by app-push-special after a special update was pushed
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists app_editions_feed_idx on public.app_editions (language, audience, published_at desc);
create index if not exists app_editions_type_idx on public.app_editions (edition_type, published_at desc);

create table if not exists public.app_edition_items (
  edition_id  uuid not null references public.app_editions(id) on delete cascade,
  item_id     uuid not null references public.app_items(id) on delete cascade,
  position    int not null default 0,
  primary key (edition_id, item_id)
);
create index if not exists app_edition_items_item_idx on public.app_edition_items (item_id);

create table if not exists public.app_audio (
  id            uuid primary key default gen_random_uuid(),
  external_id   text unique,
  kind          text not null default 'edition' check (kind in ('edition', 'flash')),
  edition_id    uuid references public.app_editions(id) on delete set null,
  language      text not null default 'he' check (language in ('he', 'en', 'fr')),
  audience      text not null default 'general' check (audience in ('general', 'youth')),
  title         text not null,
  audio_url     text not null,
  duration_sec  int,
  published_at  timestamptz not null default now(),
  status        text not null default 'published' check (status in ('draft', 'published')),
  created_at    timestamptz not null default now()
);
create index if not exists app_audio_feed_idx on public.app_audio (language, audience, published_at desc);
create index if not exists app_audio_edition_idx on public.app_audio (edition_id);

create table if not exists public.app_ads (
  id           uuid primary key default gen_random_uuid(),
  external_id  text unique,
  sponsor      text not null,
  body         text not null,
  link_url     text,
  language     text not null default 'he' check (language in ('he', 'en', 'fr')),
  audience     text not null default 'general' check (audience in ('general', 'youth')),
  edition_id   uuid references public.app_editions(id) on delete cascade,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  weight       int not null default 1 check (weight > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists app_ads_lookup_idx on public.app_ads (language, audience) where active;

create table if not exists public.app_settings (
  key    text primary key,
  value  jsonb not null
);

-- ---------------------------------------------------------------------------
-- Users (written by the app through RLS / RPCs, and by the edge functions)
-- ---------------------------------------------------------------------------

create table if not exists public.app_profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null check (length(btrim(full_name)) between 1 and 120),
  phone             text not null unique check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  email             text not null,
  birth_year        int check (birth_year between 1900 and 2100),
  city              text,
  language          text not null default 'he' check (language in ('he', 'en', 'fr')),
  audience          text not null default 'general' check (audience in ('general', 'youth')),
  frequency         int not null default 3 check (frequency between 1 and 3),
  slot_times        text[] not null default '{07:30,13:00,20:00}',
  level_filter      text not null default 'important' check (level_filter in ('critical', 'important', 'general')),
  style             text not null default 'calm' check (style in ('calm', 'human', 'informative', 'light')),
  topics            text[] not null default '{}',
  communities       text[] not null default '{}',
  special_push      boolean not null default true,
  edition_push      boolean not null default true,
  headline_in_push  boolean not null default false,
  text_scale        real not null default 1 check (text_scale between 0.5 and 3),
  theme             text not null default 'system' check (theme in ('system', 'light', 'dark')),
  shabbat_city_id   text not null default 'jerusalem' references public.app_cities(id),
  onboarded         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  constraint app_profiles_slot_times_chk check (
    cardinality(slot_times) = frequency
    and array_to_string(slot_times, ',') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$'
  )
);
create index if not exists app_profiles_email_idx on public.app_profiles (lower(email));
create index if not exists app_profiles_lang_idx on public.app_profiles (language, audience);

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
  owner_id      uuid not null references public.app_profiles(id) on delete cascade,
  member_phone  text not null check (member_phone ~ '^\+[1-9][0-9]{6,14}$'),
  member_name   text,
  status        text not null default 'invited' check (status in ('invited', 'joined', 'removed')),
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  primary key (owner_id, member_phone)
);
create index if not exists app_family_members_phone_idx on public.app_family_members (member_phone);

create table if not exists public.app_saved_items (
  profile_id  uuid not null default auth.uid() references public.app_profiles(id) on delete cascade,
  item_id     uuid not null references public.app_items(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, item_id)
);

create table if not exists public.app_reads (
  profile_id   uuid not null default auth.uid() references public.app_profiles(id) on delete cascade,
  edition_key  text not null check (length(edition_key) between 1 and 100),
  read_at      timestamptz not null default now(),
  primary key (profile_id, edition_key)
);

create table if not exists public.app_feedback (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.app_profiles(id) on delete cascade,
  item_id     uuid references public.app_items(id) on delete set null,
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
  profile_id  uuid not null references public.app_profiles(id) on delete cascade,
  title       text not null,
  body        text not null,
  item_id     uuid references public.app_items(id) on delete set null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists app_messages_profile_idx on public.app_messages (profile_id, created_at desc);

create table if not exists public.app_devices (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null default auth.uid() references public.app_profiles(id) on delete cascade,
  push_token    text not null unique,
  platform      text not null check (platform in ('android', 'ios')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists app_devices_profile_idx on public.app_devices (profile_id);

create table if not exists public.app_donations (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.app_profiles(id) on delete cascade,
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

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists app_items_touch on public.app_items;
create trigger app_items_touch before update on public.app_items
  for each row execute function public.app_touch_updated_at();

drop trigger if exists app_item_versions_touch on public.app_item_versions;
create trigger app_item_versions_touch before update on public.app_item_versions
  for each row execute function public.app_touch_updated_at();

drop trigger if exists app_editions_touch on public.app_editions;
create trigger app_editions_touch before update on public.app_editions
  for each row execute function public.app_touch_updated_at();

drop trigger if exists app_profiles_touch on public.app_profiles;
create trigger app_profiles_touch before update on public.app_profiles
  for each row execute function public.app_touch_updated_at();
