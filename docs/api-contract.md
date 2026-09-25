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
- `app_editions(id uuid pk, external_id text unique, edition_type, language, audience, published_at, title text null, status ('draft'|'published'), pushed_at timestamptz null, created_at, updated_at)` — `pushed_at` is set by `app-push-special` after a special update was pushed.
- `app_edition_items(edition_id → app_editions on delete cascade, item_id → app_items on delete cascade, position int; pk(edition_id, item_id))`
- `app_audio(id uuid pk, external_id text unique, kind, edition_id → app_editions null, language, audience, title text, audio_url text, duration_sec int, published_at, status ('draft'|'published'), created_at)`
- `app_ads(id uuid pk, external_id text unique, sponsor text, body text, link_url text null, language, audience, edition_id → app_editions null, starts_at, ends_at null, weight int default 1, active bool, created_at)`
- `app_settings(key text pk, value jsonb)` — keys: `free_archive_days` (7), `max_items` (10), `donation_url`, `support_email`, `demo_phone`, `demo_code`, `demo_email`, `demo_premium_phone`, `demo_premium_email`; server-only: `functions_base_url`, `push_webhook_secret`.

## User tables (written by the app / edge functions)

- `app_profiles(id uuid pk → auth.users, full_name text not null, phone text unique not null (E.164, e.g. +972501234567), email text not null, birth_year int null, city text null, language default 'he', audience default 'general', frequency int default 3 (1..3), slot_times text[] default '{07:30,13:00,20:00}' ('HH:MM', length = frequency), level_filter default 'important', style default 'calm', topics text[] default '{}', communities text[] default '{}', special_push bool default true, edition_push bool default true, headline_in_push bool default false, text_scale real default 1, theme text default 'system' ('system'|'light'|'dark'), shabbat_city_id text default 'jerusalem', onboarded bool default false, created_at, updated_at, last_seen_at)`
  - RLS: select/update own row. `id`, `phone`, `email`, `created_at` cannot be changed by the client (trigger).
- `app_subscriptions(id uuid pk, phone text, plan, source ('whatsapp'|'app_store'|'google_play'|'manual'), starts_at, ends_at null, external_ref text null, created_at)` — premium entitlements **keyed by phone**, so WhatsApp premium subscribers are recognised when they register with the same number. No client access.
- `app_family_members(owner_id → app_profiles, member_phone text, member_name text, status ('invited'|'joined'|'removed'), invited_at, joined_at; pk(owner_id, member_phone))` — owner manages own rows; max 4 members.
- `app_saved_items(profile_id, item_id, created_at; pk)` — own rows.
- `app_reads(profile_id, edition_key text, read_at; pk)` — own rows. `edition_key` = an edition id, or `slot:<ISO end>` for a personal edition.
- `app_feedback(id uuid pk, profile_id, item_id, kind ('helpful'|'not_helpful'|'error'|'question'), message text null, status default 'new', reply text null, replied_at null, created_at)` — insert/select own.
- `app_messages(id uuid pk, profile_id, title text, body text, item_id null, created_at, read_at null)` — in-app messages (editor replies, corrections). Select/update(read_at) own.
- `app_devices(id uuid pk, profile_id, push_token text unique, platform ('android'|'ios'), created_at, last_seen_at)` — own rows.
- `app_donations(id uuid pk, profile_id, amount numeric, currency default 'ILS', frequency ('once'|'monthly'), status default 'initiated', created_at)` — insert/select own.
- `app_pending_registrations(phone text pk, full_name, email, birth_year, city, created_at, expires_at)` — edge functions only.
- `app_login_attempts(id bigserial, phone, kind ('start'|'verify'), created_at, success bool)` — edge functions only (rate limiting).
- `app_login_codes(phone text pk, email, mode ('register'|'login'), code_hash, attempts int, created_at, expires_at)` — edge functions only: the 6-digit login codes (hashed, valid 10 minutes, 5 wrong guesses).

Clients have **no direct select** on `app_items`, `app_item_versions`, `app_edition_items`, `app_ads`, `app_subscriptions`, `app_pending_registrations`, `app_login_attempts`, `app_login_codes`: content is served only by the RPCs below, which enforce the free-archive limit and pick versions. Signed-in clients may select `app_topics`, `app_communities`, `app_cities`, `app_editions`, `app_audio` (published rows with `published_at <= now()`), and the public keys of `app_settings` (`free_archive_days`, `max_items`, `donation_url`, `support_email`).

**Before registration (anon key, no JWT)** — onboarding runs before sign-in, so the `anon` role may also select `app_topics`, `app_communities`, `app_cities` (active rows) and the same four public `app_settings` keys (never the `demo_*` keys). Everything else, including `app_editions`, `app_audio` and every RPC, needs a signed-in user.

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

- `app_me() → jsonb` — `{ profile: <app_profiles row>, is_premium: bool, plan: 'free'|'premium'|'family', family_role: 'owner'|'member'|null, unread_messages: int }`. `profile` is `null` if the signed-in user has no profile. Also updates `last_seen_at` and marks the user's pending family invitations as joined.
- `app_personal_edition(p_from timestamptz, p_to timestamptz) → Feed` — the user's personal edition: items of published editions (user's language + audience) with `published_at` in `(p_from, p_to]`, deduplicated, filtered by the profile: critical always; otherwise topic ∈ topics (empty topics = all) and level ≥ level_filter. Capped at `max_items`. Raises `archive_locked` if `p_from < now() - free_archive_days` and not premium.
- `app_edition_view(p_edition_id uuid) → Feed` — same shape for one engine edition (archive). Same premium check on its `published_at`. The edition is shown as published (no topic/level filter, no `max_items` cap), in the edition's own language/audience; for a `special` edition its items are in `special` and `items` is `[]`.
- `app_archive(p_days int default 30) → jsonb[]` — engine editions for the user's language + audience, newest first: `{ id, edition_type, title, published_at, item_count, has_audio, read, locked }` (`locked` = older than the free window and not premium).
- `app_search(p_query text, p_limit int default 30) → FeedItem[]` — premium only (raises `premium_required`); matches headline/body of the user's language (case-insensitive substring, at least 2 characters, newest first, `p_limit` ≤ 100). Each result shows a version that contains the query, preferring the reader's style.
- `app_saved() → FeedItem[]` — saved items, newest saved first (not limited by the archive window).
- `app_toggle_save(p_item_id uuid) → bool` — returns the new saved state.
- `app_mark_read(p_edition_key text) → void`.
- `app_submit_feedback(p_item_id uuid, p_kind text, p_message text default null) → uuid`.
- `app_update_profile(p_patch jsonb) → jsonb` — whitelisted keys only: full_name, birth_year, city, language, audience, frequency, slot_times, level_filter, style, topics, communities, special_push, edition_push, headline_in_push, text_scale, theme, shabbat_city_id, onboarded. Returns the updated profile.
- `app_family_invite(p_phone text, p_name text) → jsonb`, `app_family_remove(p_phone text) → void` — family owners only.
- `app_register_device(p_token text, p_platform text) → void`.
- `app_record_donation(p_amount numeric, p_frequency text) → uuid`.
- Engine only (service role, not callable by the app): `app_engine_upsert_edition(p_edition jsonb) → uuid` — upserts an edition with its items and versions in one transaction; see [`engine-integration.md`](engine-integration.md).

## Edge functions (Supabase Functions, `verify_jwt = false`)

- `POST /functions/v1/app-auth-start` `{ mode: 'register'|'login', phone, full_name?, email?, birth_year?, city? }`
  → `200 { ok: true, masked_email: 'h***@gmail.com' }` or `4xx { error: 'not_registered'|'already_registered'|'invalid_phone'|'invalid_email'|'missing_name'|'rate_limited' }`.
  Normalises the phone to E.164 (+972…), finds the email (profile, or the registration data), and emails a 6-digit code (valid 10 minutes).
  Additional errors: `400 invalid_mode`, `409 email_in_use` (the email already belongs to another profile), `503 email_not_configured` (no email provider secret set on the project; demo phones still work), `502 email_failed`, `500 server_error`.
  The code is generated by the function and sent through Brevo or Resend (secrets `BREVO_API_KEY` or `RESEND_API_KEY`, sender `EMAIL_FROM`); the shared Supabase Auth mailer is never used.
- `POST /functions/v1/app-auth-verify` `{ phone, code }`
  → `200 { access_token, refresh_token, expires_in, user_id, is_new: bool }` or `4xx { error: 'invalid_code'|'expired'|'not_found'|'rate_limited' }`.
  Creates the `app_profiles` row on first verify (from `app_pending_registrations`). The app then calls `supabase.auth.setSession({ access_token, refresh_token })`.
  Status codes: `invalid_code` 400, `not_found` 404 (no code was requested, or it was already used), `expired` 410 (code older than 10 minutes, 5 wrong guesses, or registration older than 30 minutes: ask for a new code), `rate_limited` 429; also `invalid_phone` 400, `server_error` 500. The session is a normal Supabase Auth session (refreshes with `supabase.auth`).
- Rate limits: 5 starts and 10 verifies per phone per 15 minutes. Demo phones are exempt.
- Demo accounts: phone `app_settings.demo_phone` (`+972500000000`, free plan) and `app_settings.demo_premium_phone` (`+972500000001`, premium) with code `app_settings.demo_code` (`123456`) sign in to `demo_email` / `demo_premium_email` without sending email (for testing and store review).
- `POST /functions/v1/app-push-special` — called by a database webhook when a `special` edition is published; sends FCM pushes to devices whose profile has `special_push = true` and matching language/audience. Inactive until the `FCM_SERVICE_ACCOUNT` secret exists.
  Details: the trigger `app_editions_push_special` fires once, when a special edition becomes `published` (insert as published, or draft → published); the function checks the `x-app-secret` header, pushes once per edition (`pushed_at`), skips readers whose `shabbat_city_id` is currently in Shabbat or Yom Tov, and uses the headline of the edition's first item only when `headline_in_push` is on. Tokens that look like Expo tokens (`ExponentPushToken[…]`) go through the Expo push service (works without `FCM_SERVICE_ACCOUNT`); native FCM tokens go through FCM HTTP v1. Push data: `{ type: 'special', edition_id, url: 'tamzit://edition/<id>' }`.

## Storage

- Bucket `app-media` (public): audio files (`audio/…`), share assets.
- Bucket `app-builds` (public): Android APKs (`android/tamzit-<version>.apk`).

## Errors (RPCs)

RPC errors are raised with SQLSTATE `P0001` and a stable code in `error.message`:
`not_authenticated`, `no_profile`, `archive_locked`, `premium_required`, `not_found`, `invalid_value`
(details in `error.details`), `invalid_kind`, `invalid_platform`, `invalid_amount`, `invalid_phone`,
`not_family_owner`, `family_full`, `immutable_field` (direct `update` of `id`/`phone`/`email`/`created_at`).

## Feed rules (as implemented)

- Only `published` editions with `published_at <= now()` count; the engine may insert editions ahead of time.
- `app_personal_edition`: `p_to` defaults to now, `p_from` to `p_to - 24h`. Editions of the profile's language + audience with `published_at` in `(p_from, p_to]`; `archive_locked` has 10 minutes of grace for client clocks.
- `items`: `kind = 'news'`, deduplicated, without items that are also in `special`; ordered by level, then `published_at` desc, then position; capped at `max_items` (general items drop first).
- Version: reader's language → reader's audience (youth falls back to general) → reader's style → `informative` → any style. `saved` lists versions in any language if the reader changed language.
- `community`: up to 3 per community (profile order), from the editions or published in the window.
- `good_news`: the latest good item of the window; if none, the latest of the 48 hours before `p_to`.
- `ad`: free readers only; active, `starts_at <= now() < ends_at` (or no end), language + audience; an ad tied to an edition wins over generic ones; otherwise weighted random by `weight`.
- `audio`: audio linked to the edition first, otherwise the latest published audio for language + audience in the window (at least the last 24 hours), preferring kind `edition`. `has_audio` in `app_archive` follows the same rule.
- `minutes` = ceil(words of headline + body of items, special, community and good news / 180), at least 1.
- `app_archive.item_count` counts the edition's published `news` items; `read` = an `app_reads` row with `edition_key = <edition id>`.

