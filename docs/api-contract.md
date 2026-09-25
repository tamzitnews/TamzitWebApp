# Tamzit app: data contract (Supabase ⇄ mobile app)

Single source of truth for the database objects the app reads and writes, on the Supabase project
**tamzitnews_v1**. The app talks to the backend **only through the RPCs and edge functions below** (plus
the anon-readable reference tables). Content comes from the **existing engine tables** of the WhatsApp service
(`tamzit_editions`, `tamzit_edition_elements`, `processed_stories`) and profiles live in the existing
`user_preferences` table; the app never reads or writes those tables directly. Every object the app backend
created is named `app_…`. Other tables in the project (`news_items`, `news_summaries`, `scheduled_summaries`,
`promo_*`, …) belong to other systems: never touch them.

## What changed with the move to the existing tables (for the app)

- **Ids are strings.** Edition ids are the `tamzit_editions.id` numbers as strings (`"2038"`); item ids are
  `"e<edition id>-<n>"` (the n-th item parsed from that edition's WhatsApp text) or `"s<story id>"` (a
  structured story); ad ids `"ad<element id>"`, audio ids `"au<element id>"`. Treat all of them as opaque.
- **`headline` is usually `""`**: the WhatsApp editions have bullets without titles. Render the body; show a
  headline only when it is non-empty (structured stories and bullets that start with `*Title:*` have one).
- **`style` is `"informative"`** for parsed items (the WhatsApp text has one version). Structured stories follow
  the reader's style when the engine wrote that version.
- **Two heading levels**: `section` is the level-1 heading ("ביטחון", "מהמתרחש בארץ", "Security") and
  `subsection` the level-2 heading inside it ("החזית הדרומית", "Southern Front") or `null`. The security fronts
  are grouped under one security section whatever the edition wrote ("📌 החזית הדרומית", "📌 ביטחון - החזית
  הדרומית", "Le front sud"). `Feed.items` arrive in reading order, grouped by section then subsection; the app
  opens a heading wherever they change. `topic_name` = `subsection ?? section`; `topic_id` is the mapped app
  topic or `null` ("מהמתרחש בארץ" has none). Items with `topic_id = null` are shown to every reader.
- **`community` is `[]`** until the engine writes community stories. **`special`** has items only when a
  special update (`edition_type 'special_update'`) falls in the window.
- **`audio.audio_url`** is always a playable public https link on Supabase Storage, never a Drive link
  (see "Audio and ads" below); `duration_sec` is `null`. `audio` is `null` when there is no playable audio.
- **`ad`** is `{ id, label, sponsor, body, link_url, image_url }`: `label` is the ad's own overline ("המהדורה
  בחסות", "תוכן שיווקי"; else "פרסומת" / "Sponsored" / "Publicité"), `sponsor` a leading all-bold line or `null`,
  `body` the full text, `link_url` its first link, `image_url` the attached image or the link's preview image
  (like WhatsApp) or `null`. The app shows it right after the first section; tapping the card or the image opens
  `link_url`.
- `app_archive` rows have a new field `track` (`classic` | `daily` | `teens` | `special`).
- **No direct table access for profiles or editions**: `app_profiles`, `app_editions`, `app_items`, `app_audio`,
  `app_ads` no longer exist. Read the profile with `app_me()` and change it with `app_update_profile()`.
- `app_edition_view(p_edition_id bigint)`, `app_toggle_save(p_item_id text)`, `app_submit_feedback(p_item_id text, …)`
  take the new id formats (PostgREST accepts the edition id as a number or a numeric string).

## Enumerations

| name | values |
| --- | --- |
| language | `he`, `en`, `fr` (stored in `tamzit_editions.language` as `hebrew`, `english`, `french`) |
| audience | `general`, `youth` (youth = ages 10–15 track) |
| level | `critical` (rank 3), `important` (2), `general` (1) |
| style | `calm`, `human`, `informative`, `light` |
| item kind | `news`, `good_news` ("ונסיים בטוב"), `community` |
| edition type | `morning`, `noon`, `evening`, `erev_shabbat`, `motzash`, `special` |
| track | `classic` (3 a day), `daily` (1 a day), `teens`, `special` |
| audio kind | `edition` (`flash` reserved) |
| plan | `premium`, `family` |
| level filter (profile) | `critical` (only rank 3), `important` (rank ≥ 2), `general` (all) |

## Where the data comes from

### Editions: `tamzit_editions` (engine, existing)

`tamzit_editions(id bigint, created_at, edition_date date, main_text text, language 'hebrew'|'english'|'french',
edition_type 'classic'|'daily'|'special_update'|'teens', time_slot 'בוקר'|'צהריים'|'צוהריים'|'ערב'|'יומי'|'עדכון מיוחד')`.
`main_text` is the full WhatsApp edition. Mapping:

| app | from |
| --- | --- |
| edition id | `id` (as a string); the engine inserts every edition several times (one row per WhatsApp group): identical texts of the same slot and day collapse to the first row, and when a slot was re-sent with a different text the newest text wins (special updates keep each distinct text) |
| published_at | `created_at` of that first row |
| language | `hebrew`/`english`/`french` → `he`/`en`/`fr` |
| audience | `edition_type = 'teens'` → `youth`, else `general` |
| track | `classic`, `daily`, `teens`, `special_update` → `special` |
| edition_type | `special_update` → `special`; title with "מוצאי"/"Motzei" → `motzash`; "ערב שבת"/"ערב חג"/"Erev" → `erev_shabbat`; else by `time_slot`: `בוקר` → `morning`, `צהריים`/`צוהריים` → `noon`, `ערב`/`יומי` → `evening` |
| title | the edition name in the header ("מהדורת בוקר", "המהדורה היומית", "Morning Edition", "Édition quotidienne", "עדכון מיוחד") |

**Reader's track** (which editions a reader gets): youth → `teens`, falling back to `classic`, then `daily`;
frequency 1 → `daily`, then `classic`; frequency 2–3 → `classic`, then `daily`. The fallback is **per day**: on a
day without an edition of the preferred track, that day's editions of the next track are used (the French
service, for example, is mostly `daily`). Special updates of the reader's language are always included.

### Items: structured stories, or the parsed WhatsApp text

- If the edition has `tamzit_edition_elements` rows with `element_type = 'story'` (written by the engine,
  see [`engine-integration.md`](engine-integration.md)), its items are those `processed_stories`, in `position`
  order: id `s<story id>`, level from `severity` (≥ 3 critical, 2 important, else general), `topic_id` from
  `topic`, `kind`, `community_id`, `corrected_at`, and the version picked from `versions`
  (`{ "he": { "general": { "calm": { "headline", "body" }, … } }, "en": … }`): reader's language → audience
  (youth falls back to general) → style → `informative` → any style; `title`/`summary` are the Hebrew base version.
- Otherwise the items are **parsed from `main_text`** (server side, `app_parse_edition`): sections
  `📌 *_title:_*` (also `📌 title:`, `📌 title`, `⬆️ *title:*`, `> *title:*`) → `section` / `subsection`
  (`app_section_split`: "ביטחון - X" → ביטחון / X; "החזית …", "חזית איו"ש" → ביטחון / title; "… Front", "Yehuda and
  Shomron" → Security / title; "Le front …", "Au nord" → Sécurité / title; "ביטחון"/"Security" alone → that section
  without a subsection; anything else → the title / `null`); each `• ` bullet with its
  continuation lines → one item; the good-news section ("ונסיים בטוב", "On a Positive Note", "Et pour finir sur une
  bonne note", …) → `good_news`; the header, promo blocks between `•   •   •` separators, "תוכן שיווקי"/sponsored
  blocks, notices ("קוראים יקרים"), credits and link-only lines are skipped; WhatsApp markup (`*bold*`, `_italic_`,
  `~strike~`) is removed. Parsed items: level `important` (`critical` in special updates), style `informative`,
  headline = a leading `*bold lead-in:*` if present, else `""`, id `e<edition id>-<n>`. A special update is one
  item (its text).
- `topic_id` of a parsed item: the first `app_topics` row (by `sort`) whose `keywords` occur in
  "section / subsection" ("ביטחון / החזית הדרומית" → `security`, "מדיניות, משפט ופוליטיקה" → `politics`,
  "מסביב לעולם" → `world`, …).

### Audio and ads: `tamzit_edition_elements` and the `news-audio` bucket (engine, existing)

`tamzit_edition_elements(id, created_at, edition_id → tamzit_editions, element_type 'audio'|'ad'|'donation_campaign'|'cta_link'|'story', content_text, media_id, story_id, position)`.
`media_id` is a Google Drive link. Two things the engine does that the app works around:

- **Drive files are private** (a Google login is needed), so the app never gets a Drive link. The edge function
  `app-media-sync` copies what is needed into the public `app-media` bucket once the files can be read (shared
  "anyone with the link"), and until then the audio / image is simply left out.
- **`edition_id` is sometimes another language's row**: the engine sends the Hebrew and English editions at the
  same second and occasionally links an element to the other one. So elements are matched to an edition by
  language and send time (`app_edition_ad`, `app_edition_audio`), not by `edition_id` alone.

- **Audio** (`app_edition_audio`) → `Feed.audio`, `title` = "האזנה · <edition title>":
  1. the engine's mp3 in the public **`news-audio`** bucket (`<date>news.mp3` Hebrew, `<date>news-french.mp3`
     French), made minutes before the edition is sent: the file created between 45 minutes before and 2 minutes
     after the edition's first send; when several fit, the one whose length suits the text (≈ 9 Hebrew / 13.5 French
     characters a second). That bucket keeps files about a day, so `app-media-sync` copies them to
     `app-media/news-audio/` (kept 8 days) and the copy is used when there is one;
  2. else the `audio` element (Drive) sent with the edition, copied to `app-media/drive/` (English; the last 2 days).
- **Ad** (`app_edition_ad` + `app_ad_json`) → `Feed.ad` for non-premium readers: an `ad`, `donation_campaign` or
  `cta_link` element whose text is in the reader's language, linked to the edition or created from 2 minutes before
  its first send to 20 minutes after its last one (`ad` first, then the newest). `label` = the "> …" line without
  the colon ("המהדורה בחסות"), `sponsor` = a leading all-bold line or `null`, `body` = the rest without markup and
  link-only lines, `link_url` = the first URL, `image_url` = the attached Drive image once copied, else the preview
  image of `link_url` (`og:image` / `twitter:image`, YouTube thumbnail; copied to `app-media/previews/`), else `null`.
- **`app-media-sync`** (edge function, `verify_jwt = false`, header `x-app-secret` = `app_settings.push_webhook_secret`)
  is called by `app_media_kick()`: a statement trigger on new `tamzit_edition_elements` rows and the pg_cron job
  `app-media-sync` every 5 minutes. Its queue is `app_media` (key = Drive id, or `na:<storage object id>` for a
  news-audio file; `status` pending | ok | private | failed | expired) and `app_link_previews` (`status` pending |
  ok | none | failed), filled by `app_media_queue()`. Private and failed files are retried with backoff (5 minutes,
  doubling, at most 3 hours apart).

### Profiles: `user_preferences` (existing) + added columns

| contract field | `user_preferences` column |
| --- | --- |
| id | `user_id` (= `auth.users.id` for app users) |
| full_name | `name` |
| frequency (1..3) | `update_frequency` (clamped to 1..3) |
| style | `persona`: `Calming` ↔ calm, `Informative` ↔ informative, `Buddy` ↔ light, `Human` ↔ human; `Contextualizer` / `Executive` read as informative |
| level_filter | `anxiety_level`: `High` ↔ critical, `Medium` ↔ important, `Low` ↔ general |
| topics | `interests` |
| phone, email, birth_year, city, language ('he'), audience ('general'), slot_times ('{10:00,16:00,21:30}'), communities ('{}'), special_push (true), edition_push (true), headline_in_push (false), text_scale (1), theme ('system'), shabbat_city_id ('jerusalem'), onboarded (false), updated_at, last_seen_at | added columns of the same names (defaults in brackets; `phone` unique when set) |
| created_at | `created_at` |

The profile JSON (`app_me().profile`, `app_update_profile()`) keeps the contract shape:
`{ id, full_name, phone, email, birth_year, city, language, audience, frequency, slot_times, level_filter, style,
topics, communities, special_push, edition_push, headline_in_push, text_scale, theme, shabbat_city_id, onboarded,
created_at, updated_at, last_seen_at }`.

## App tables (`app_…`)

Reference data:
- `app_topics(id text pk, name_he, name_en, name_fr, sort int, is_default bool, active bool, keywords text[])`
- `app_communities(id text pk, name_he, name_en, name_fr, description_he, description_en, description_fr, city_id text → app_cities, sort, active)`
- `app_cities(id text pk, name_he, name_en, name_fr, lat float8, lon float8, tzid text, in_israel bool, candle_minutes int, sort, active)` — Shabbat times and the registration city list.
- `app_rest_periods(city_id → app_cities, starts_at, ends_at, kind ('shabbat'|'yomtov'), includes_shabbat bool, holiday_name text null; pk(city_id, starts_at))` — see below.
- `app_settings(key text pk, value jsonb)` — keys: `free_archive_days` (7), `max_items` (10), `donation_url`, `support_email`, `demo_phone`, `demo_code`, `demo_email`, `demo_premium_phone`, `demo_premium_email`, `demo_family_phone`, `demo_family_email`; server-only: `functions_base_url`, `push_webhook_secret`.

User data (`profile_id` / `owner_id` → `user_preferences(user_id)` on delete cascade):
- `app_subscriptions(id uuid pk, phone text, plan, source ('whatsapp'|'app_store'|'google_play'|'manual'), starts_at, ends_at null, external_ref text unique null, created_at)` — premium entitlements **keyed by phone**, so WhatsApp premium subscribers are recognised when they register with the same number. No client access.
- `app_family_members(owner_id, member_phone text, member_name text, status ('invited'|'joined'|'removed'), invited_at, joined_at; pk(owner_id, member_phone))` — the owner manages own rows; a member can read the rows naming their phone; max 4 members.
- `app_saved_items(profile_id, item_id text, created_at, snapshot jsonb; pk)` — own rows (`snapshot` = the item at save time, used when its edition or story is gone).
- `app_reads(profile_id, edition_key text, read_at; pk)` — own rows. `edition_key` = an edition id (string), or `slot:<ISO end>` for a personal edition.
- `app_feedback(id uuid pk, profile_id, item_id text null, kind ('helpful'|'not_helpful'|'error'|'question'), message text null, status default 'new', reply text null, replied_at null, created_at)` — insert/select own.
- `app_messages(id uuid pk, profile_id, title text, body text, item_id text null, created_at, read_at null)` — in-app messages (editor replies, corrections). Select/update(read_at) own.
- `app_devices(id uuid pk, profile_id, push_token text unique, platform ('android'|'ios'), created_at, last_seen_at)` — own rows.
- `app_donations(id uuid pk, profile_id, amount numeric, currency default 'ILS', frequency ('once'|'monthly'), status default 'initiated', created_at)` — insert/select own.
- Edge functions only: `app_pending_registrations(phone pk, full_name, email, birth_year, city, created_at, expires_at)`, `app_login_attempts(id, phone, kind ('start'|'verify'), created_at, success)`, `app_login_codes(phone pk, email, mode, code_hash, attempts, created_at, expires_at)` (6-digit codes, hashed, 10 minutes, 5 wrong guesses), `app_push_log(key pk, edition_id, created_at, pushed_at, result)` (one push per distinct special update).

**Client access.** Anon (before registration, onboarding) and signed-in users may select `app_topics`,
`app_communities`, `app_cities` (active rows), `app_rest_periods`, and the public keys of `app_settings`
(`free_archive_days`, `max_items`, `donation_url`, `support_email`; never `demo_*`). Signed-in users have own-row
access to the user tables as listed. Everything else (the engine tables, `user_preferences`, subscriptions, the
edge-function tables) is not readable by clients: content and the profile come from the RPCs.

## RPCs (all `security definer`, use `auth.uid()`; call with `supabase.rpc(name, args)`; signed-in users only)

### Shared JSON shapes

```ts
type FeedItem = {
  id: string;                     // 'e<edition id>-<n>' (parsed) or 's<story id>' (structured)
  topic_id: string | null;        // app topic, or null (shown to everyone)
  topic_name: string | null;      // subsection ?? section (parsed); story: topic name
  section: string | null;         // level-1 heading ("ביטחון", "מהמתרחש בארץ", "Security"); story: topic name
  subsection: string | null;      // level-2 heading ("החזית הדרומית") or null
  level: 'critical'|'important'|'general';
  kind: 'news'|'good_news'|'community'; community_id: string | null; community_name: string | null;
  headline: string;               // often '' for parsed items
  body: string;                   // plain text, may contain '\n'
  style: string;                  // 'informative' for parsed items
  published_at: string; corrected_at: string | null;
  saved: boolean;
};
type Feed = {
  window: { from: string; to: string };            // ISO timestamps
  edition_types: string[];                          // editions included (contract types), newest first
  title: string | null;                             // edition title when the feed has one edition
  items: FeedItem[];                                // kind='news', filtered, ordered: level desc, published desc, position
  special: FeedItem[];                              // items of special updates in the window (often [])
  community: FeedItem[];                            // kind='community' for the user's communities (often [])
  good_news: FeedItem | null;                       // latest good-news item in the window
  ad: { id: string; label: string; sponsor: string | null; body: string; link_url: string | null; image_url: string | null } | null;  // null for premium
  audio: { id: string; kind: 'edition'|'flash'; title: string; audio_url: string; duration_sec: number | null; published_at: string } | null;
  minutes: number;                                  // estimated reading time (words / 180, min 1)
  is_premium: boolean;
};
```

### Functions

- `app_me() → jsonb` — `{ profile: <profile JSON>, is_premium: bool, plan: 'free'|'premium'|'family', family_role: 'owner'|'member'|null, unread_messages: int }`. `profile` is `null` if the signed-in user has no profile. Also updates `last_seen_at` and marks the user's pending family invitations as joined.
- `app_personal_edition(p_from timestamptz default null, p_to timestamptz default null) → Feed` — the reader's editions (language + track, see above) with `published_at` in `(p_from, p_to]` (defaults: the last 24 hours), filtered by the profile: critical always; otherwise (topic_id is null, or topics empty, or topic_id ∈ topics) and level ≥ level_filter. Capped at `max_items`. Raises `archive_locked` if `p_from < now() - free_archive_days` (10 minutes grace) and not premium.
- `app_edition_view(p_edition_id bigint) → Feed` — one edition as published (no topic/level filter, no cap), in the edition's own language/audience. Same premium check on its `published_at`. For a special update its items are in `special` and `items` is `[]`. Unknown id → `not_found`.
- `app_archive(p_days int default 30) → jsonb` (array, newest first) — the reader's editions (language + per-day track, plus special updates): `{ id: string, edition_type, title, published_at, item_count, has_audio, read, locked, track }` (`locked` = older than the free window and not premium).
- `app_search(p_query text, p_limit int default 30) → FeedItem[]` — premium only (raises `premium_required`): items of the reader's editions whose headline or body contains the query (case-insensitive, at least 2 characters, newest first, `p_limit` ≤ 100).
- `app_saved() → FeedItem[]` — saved items, newest saved first (not limited by the archive window).
- `app_toggle_save(p_item_id text) → bool` — returns the new saved state; unknown item → `not_found`.
- `app_mark_read(p_edition_key text) → void`.
- `app_submit_feedback(p_item_id text, p_kind text, p_message text default null) → uuid`.
- `app_update_profile(p_patch jsonb) → jsonb` — whitelisted keys only: full_name, birth_year, city, language, audience, frequency, slot_times, level_filter, style, topics, communities, special_push, edition_push, headline_in_push, text_scale, theme, shabbat_city_id, onboarded (other keys are ignored). A new `frequency` without `slot_times` gets the default times. Invalid values raise `invalid_value` with the field in `error.details`. Returns the profile JSON.
- `app_family_invite(p_phone text, p_name text) → jsonb`, `app_family_remove(p_phone text) → void` — family owners only.
- `app_register_device(p_token text, p_platform text) → void`.
- `app_record_donation(p_amount numeric, p_frequency text) → uuid`.
- Engine only (service role): `app_engine_upsert_edition(p_edition jsonb) → jsonb` — writes a `tamzit_editions` row with structured stories; see [`engine-integration.md`](engine-integration.md).

## Edge functions (Supabase Functions, `verify_jwt = false`)

- `POST /functions/v1/app-auth-start` `{ mode: 'register'|'login', phone, full_name?, email?, birth_year?, city? }`
  → `200 { ok: true, masked_email: 'h***@gmail.com' }` or `4xx { error: 'not_registered'|'already_registered'|'invalid_phone'|'invalid_email'|'missing_name'|'rate_limited' }`.
  Normalises the phone to E.164 (+972…), finds the email (the `user_preferences` row with that phone, or the registration data), and emails a 6-digit code (valid 10 minutes).
  Additional errors: `400 invalid_mode`, `409 email_in_use` (the email already belongs to another profile), `503 email_not_configured` (no email provider secret set on the project; demo phones still work), `502 email_failed`, `500 server_error`.
  The code is generated by the function and sent through Brevo or Resend (secrets `BREVO_API_KEY` or `RESEND_API_KEY`, sender `EMAIL_FROM`); the Supabase Auth mailer is never used.
- `POST /functions/v1/app-auth-verify` `{ phone, code }`
  → `200 { access_token, refresh_token, expires_in, user_id, is_new: bool }` or `4xx { error: 'invalid_code'|'expired'|'not_found'|'rate_limited' }`.
  Creates the `user_preferences` row on first verify (from `app_pending_registrations`). The app then calls `supabase.auth.setSession({ access_token, refresh_token })`.
  Status codes: `invalid_code` 400, `not_found` 404 (no code was requested, or it was already used), `expired` 410 (code older than 10 minutes, 5 wrong guesses, or registration older than 30 minutes: ask for a new code), `rate_limited` 429; also `invalid_phone` 400, `server_error` 500. The session is a normal Supabase Auth session (refreshes with `supabase.auth`).
- Rate limits: 5 starts and 10 verifies per phone per 15 minutes. Demo phones are exempt.
- Demo accounts (code `app_settings.demo_code` = `123456`, no email is sent; for testing and store review):

  | phone | settings keys | email | plan |
  | --- | --- | --- | --- |
  | `+972500000000` | `demo_phone`, `demo_email` | `demo@tamzit-app.test` | free |
  | `+972500000001` | `demo_premium_phone`, `demo_premium_email` | `demo-premium@tamzit-app.test` | premium (manual subscription); has 2 in-app messages, 1 unread |
  | `+972500000002` | `demo_family_phone`, `demo_family_email` | `demo-family@tamzit-app.test` | family owner (manual subscription); one invited member `+972500000003` |

  The demo accounts are shared by everyone testing: expect other testers to change their preferences.
- `POST /functions/v1/app-push-special` — called by the trigger `app_tamzit_editions_push` (pg_net, AFTER INSERT on `tamzit_editions`) once per distinct special update (`edition_type = 'special_update'`; the engine's duplicate rows are claimed once in `app_push_log`); checks the `x-app-secret` header; ignores editions older than 6 hours. Sends to devices whose profile has `special_push = true` and the edition's language, except readers whose `shabbat_city_id` is inside an `app_rest_periods` period right now; the text is the first item only when `headline_in_push` is on. Expo tokens (`ExponentPushToken[…]`) go through the Expo push service; native FCM tokens through FCM HTTP v1, inactive until the `FCM_SERVICE_ACCOUNT` secret exists. Push data: `{ type: 'special', edition_id: '<id>', url: 'tamzit://edition/<id>' }`.

## Rest periods (Shabbat / Yom Tov times)

- `app_rest_periods(city_id → app_cities on delete cascade, starts_at timestamptz, ends_at timestamptz, kind ('shabbat'|'yomtov'), includes_shabbat bool, holiday_name text null; pk(city_id, starts_at))` — candle lighting → havdalah per city, consecutive days merged, Israel vs diaspora by city. Readable by anon and authenticated. Filled by `supabase/scripts/gen_rest_periods.mjs` (server-side; the app ships no calendar library): re-run at least yearly and whenever a city is added or its coordinates / candle_minutes change. The app downloads now−7d → now+90d for the reader's city and keeps it on the device; offline with no data it falls back to its own sunset calculation for plain Shabbat.

## Storage

- Bucket `app-media` (public): share assets.
- Bucket `app-builds` (public): Android APKs (`android/tamzit-<version>.apk`).
- `app-media` (public) also holds `drive/` (copies of Drive files), `news-audio/` (copies of the engine's `news-audio` mp3s, kept 8 days) and `previews/` (link preview images), all written by `app-media-sync`. The engine's `news-audio` bucket (public) is emptied by its own jobs after about a day.

## Errors (RPCs)

RPC errors are raised with SQLSTATE `P0001` and a stable code in `error.message`:
`not_authenticated`, `no_profile`, `archive_locked`, `premium_required`, `not_found`, `invalid_value`
(details in `error.details`), `invalid_kind`, `invalid_platform`, `invalid_amount`, `invalid_phone`,
`not_family_owner`, `family_full`.

## Feed rules (as implemented)

- Only editions with `created_at <= now()` count. Duplicate rows collapse as described above.
- `items`: `kind = 'news'`; the personal edition keeps the top `max_items` by level, then `published_at` desc, then position (general items drop first). They are returned grouped for reading: sections in the order they first appear (newest edition first, weather always last), subsections likewise inside their section, then level, edition (newest first) and position. An archived edition keeps its own order.
- `good_news`: the newest good-news item of the window; if none, the newest of the reader's editions in the 48 hours before `p_to`.
- `ad`: free readers only; the ad (`ad`, `donation_campaign` or `cta_link`, in the reader's language) of the newest edition in the feed that has one. The app shows it right after the first section.
- `audio`: the playable audio (`app_edition_audio`) of the newest edition in the feed that has one; for the personal edition, otherwise that of the newest of the reader's editions in the 24 hours before `p_to`. `has_audio` in `app_archive` = the edition has playable audio.
- `minutes` = ceil(words of headline + body of items, special, community and good news / 180), at least 1.
- `app_archive.item_count` counts the edition's `news` items; `read` = an `app_reads` row with `edition_key = <edition id>`.
- Retention: the engine's maintenance jobs delete `processed_stories` older than 14 days (their story elements go with them); such editions fall back to the parsed text, and saved items fall back to `snapshot`.
