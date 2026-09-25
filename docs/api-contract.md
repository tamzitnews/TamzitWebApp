# Tamzit app: data contract (Supabase ⇄ mobile app)

Single source of truth for the database objects the app reads and writes. Every object is in the
`public` schema and **every name starts with `app_`** (the project also holds unrelated `tmz_*` tables:
never touch them). The production engine writes content with the service-role key; the app reads
through RLS and RPCs with the user's JWT.

## Enumerations (text + CHECK constraints)

| name | values |
| --- | --- |
| language | `he`, `en`, `fr` |
| audience | `general`, `youth` (youth = ages 10–15 track) |
| level | `critical` (rank 3), `important` (2), `general` (1) |
| style | `calm`, `human`, `informative`, `light` |
| item kind | `news`, `good_news` ("ונסיים בטוב"), `community` |
| edition type | `morning`, `noon`, `evening`, `erev_shabbat`, `motzash`, `special` |
| audio kind | `edition`, `flash` |
| plan | `premium`, `family` |
| level filter (profile) | `critical` (only rank 3), `important` (rank ≥ 2), `general` (all) |

## Content tables (written by the engine)

- `app_topics(id text pk, name_he, name_en, name_fr, sort int, is_default bool, active bool)`
- `app_communities(id text pk, name_he, name_en, name_fr, description_he, description_en, description_fr, city_id text → app_cities, sort, active)`
- `app_cities(id text pk, name_he, name_en, name_fr, lat float8, lon float8, tzid text, in_israel bool, candle_minutes int, sort, active)` — used for Shabbat times and the registration city list.
- `app_items(id uuid pk, external_id text unique, topic_id → app_topics, level, kind, community_id → app_communities null, published_at timestamptz, status ('draft'|'published'|'retracted'), corrected_at timestamptz null, source_url text null, created_at, updated_at)`
- `app_item_versions(item_id → app_items on delete cascade, language, audience, style, headline text, body text, updated_at; pk(item_id, language, audience, style))` — the engine writes one row per language × audience × style it produced. Missing styles fall back to `informative`, then to any style.
- `app_editions(id uuid pk, external_id text unique, edition_type, language, audience, published_at, title text null, status ('draft'|'published'), created_at)`
- `app_edition_items(edition_id → app_editions on delete cascade, item_id → app_items on delete cascade, position int; pk(edition_id, item_id))`
- `app_audio(id uuid pk, external_id text unique, kind, edition_id → app_editions null, language, audience, title text, audio_url text, duration_sec int, published_at, status)`
- `app_ads(id uuid pk, external_id text unique, sponsor text, body text, link_url text null, language, audience, edition_id → app_editions null, starts_at, ends_at, weight int default 1, active bool)`
- `app_settings(key text pk, value jsonb)` — keys: `free_archive_days` (7), `max_items` (10), `donation_url`, `support_email`, `demo_phone`, `demo_code`, `demo_email`.

## User tables (written by the app / edge functions)

- `app_profiles(id uuid pk → auth.users, full_name text not null, phone text unique not null (E.164, e.g. +972501234567), email text not null, birth_year int null, city text null, language default 'he', audience default 'general', frequency int default 3 (1..3), slot_times text[] default '{07:30,13:00,20:00}' ('HH:MM', length = frequency), level_filter default 'important', style default 'calm', topics text[] default '{}', communities text[] default '{}', special_push bool default true, edition_push bool default true, headline_in_push bool default false, text_scale real default 1, theme text default 'system' ('system'|'light'|'dark'), shabbat_city_id text default 'jerusalem', onboarded bool default false, created_at, updated_at, last_seen_at)`
  - RLS: select/update own row. `id`, `phone`, `email`, `created_at` cannot be changed by the client (trigger).
- `app_subscriptions(id uuid pk, phone text, plan, source ('whatsapp'|'app_store'|'google_play'|'manual'), starts_at, ends_at null, created_at)` — premium entitlements **keyed by phone**, so WhatsApp premium subscribers are recognised when they register with the same number. No client access.
- `app_family_members(owner_id → app_profiles, member_phone text, member_name text, status ('invited'|'joined'|'removed'), invited_at, joined_at; pk(owner_id, member_phone))` — owner manages own rows; max 4 members.
- `app_saved_items(profile_id, item_id, created_at; pk)` — own rows.
- `app_reads(profile_id, edition_key text, read_at; pk)` — own rows. `edition_key` = an edition id, or `slot:<ISO end>` for a personal edition.
- `app_feedback(id uuid pk, profile_id, item_id, kind ('helpful'|'not_helpful'|'error'|'question'), message text null, status default 'new', reply text null, replied_at null, created_at)` — insert/select own.
- `app_messages(id uuid pk, profile_id, title text, body text, item_id null, created_at, read_at null)` — in-app messages (editor replies, corrections). Select/update(read_at) own.
- `app_devices(id uuid pk, profile_id, push_token text unique, platform ('android'|'ios'), created_at, last_seen_at)` — own rows.
- `app_donations(id uuid pk, profile_id, amount numeric, currency default 'ILS', frequency ('once'|'monthly'), status default 'initiated', created_at)` — insert/select own.
- `app_pending_registrations(phone text pk, full_name, email, birth_year, city, created_at, expires_at)` — edge functions only.
- `app_login_attempts(id bigserial, phone, created_at, success bool)` — edge functions only (rate limiting).

Clients have **no direct select** on `app_items`, `app_item_versions`, `app_ads`, `app_subscriptions`: content is served only by the RPCs below, which enforce the free-archive limit and pick versions. Clients may select `app_topics`, `app_communities`, `app_cities`, `app_editions`, `app_audio`, and the public keys of `app_settings` (`free_archive_days`, `max_items`, `donation_url`, `support_email`).

## RPCs (all `security definer`, use `auth.uid()`; call with `supabase.rpc(name, args)`)

### Shared JSON shapes

```ts
type FeedItem = {
  id: string; topic_id: string | null; topic_name: string | null; level: 'critical'|'important'|'general';
  kind: 'news'|'good_news'|'community'; community_id: string | null; community_name: string | null;
  headline: string; body: string; style: string; published_at: string; corrected_at: string | null;
  saved: boolean;
};
type Feed = {
  window: { from: string; to: string };            // ISO timestamps
  edition_types: string[];                          // engine editions included, newest first
  title: string | null;                             // single-edition title override
  items: FeedItem[];                                // kind='news', filtered, ordered: level desc, published desc, position
  special: FeedItem[];                              // items of 'special' editions in the window
  community: FeedItem[];                            // kind='community' for the user's communities
  good_news: FeedItem | null;                       // latest kind='good_news' in the window
  ad: { id: string; sponsor: string; body: string; link_url: string | null } | null;  // null for premium
  audio: { id: string; kind: 'edition'|'flash'; title: string; audio_url: string; duration_sec: number | null; published_at: string } | null;
  minutes: number;                                  // estimated reading time (words / 180, min 1)
  is_premium: boolean;
};
```

### Functions

- `app_me() → jsonb` — `{ profile: <app_profiles row>, is_premium: bool, plan: 'free'|'premium'|'family', family_role: 'owner'|'member'|null, unread_messages: int }`.
- `app_personal_edition(p_from timestamptz, p_to timestamptz) → Feed` — the user's personal edition: items of published editions (user's language + audience) with `published_at` in `(p_from, p_to]`, deduplicated, filtered by the profile: critical always; otherwise topic ∈ topics (empty topics = all) and level ≥ level_filter. Capped at `max_items`. Raises `archive_locked` if `p_from < now() - free_archive_days` and not premium.
- `app_edition_view(p_edition_id uuid) → Feed` — same shape for one engine edition (archive). Same premium check on its `published_at`.
- `app_archive(p_days int default 30) → jsonb[]` — engine editions for the user's language + audience, newest first: `{ id, edition_type, title, published_at, item_count, has_audio, read, locked }` (`locked` = older than the free window and not premium).
- `app_search(p_query text, p_limit int default 30) → FeedItem[]` — premium only (raises `premium_required`); matches headline/body of the user's language.
- `app_saved() → FeedItem[]` — saved items, newest saved first (not limited by the archive window).
- `app_toggle_save(p_item_id uuid) → bool` — returns the new saved state.
- `app_mark_read(p_edition_key text) → void`.
- `app_submit_feedback(p_item_id uuid, p_kind text, p_message text default null) → uuid`.
- `app_update_profile(p_patch jsonb) → jsonb` — whitelisted keys only: full_name, birth_year, city, language, audience, frequency, slot_times, level_filter, style, topics, communities, special_push, edition_push, headline_in_push, text_scale, theme, shabbat_city_id, onboarded. Returns the updated profile.
- `app_family_invite(p_phone text, p_name text) → jsonb`, `app_family_remove(p_phone text) → void` — family owners only.
- `app_register_device(p_token text, p_platform text) → void`.
- `app_record_donation(p_amount numeric, p_frequency text) → uuid`.

## Edge functions (Supabase Functions, `verify_jwt = false`)

- `POST /functions/v1/app-auth-start` `{ mode: 'register'|'login', phone, full_name?, email?, birth_year?, city? }`
  → `200 { ok: true, masked_email: 'h***@gmail.com' }` or `4xx { error: 'not_registered'|'already_registered'|'invalid_phone'|'invalid_email'|'missing_name'|'rate_limited' }`.
  Normalises the phone to E.164 (+972…), finds the email (profile, or the registration data), and has Supabase Auth send a 6-digit code to that email.
- `POST /functions/v1/app-auth-verify` `{ phone, code }`
  → `200 { access_token, refresh_token, expires_in, user_id, is_new: bool }` or `4xx { error: 'invalid_code'|'expired'|'not_found'|'rate_limited' }`.
  Creates the `app_profiles` row on first verify (from `app_pending_registrations`). The app then calls `supabase.auth.setSession({ access_token, refresh_token })`.
- Demo account: phone `app_settings.demo_phone` with code `app_settings.demo_code` signs in to `demo_email` without sending email (for testing and store review).
- `POST /functions/v1/app-push-special` — called by a database webhook when a `special` edition is published; sends FCM pushes to devices whose profile has `special_push = true` and matching language/audience. Inactive until the `FCM_SERVICE_ACCOUNT` secret exists.

## Storage

- Bucket `app-media` (public): audio files (`audio/…`), share assets.
- Bucket `app-builds` (public): Android APKs (`android/tamzit-<version>.apk`).
