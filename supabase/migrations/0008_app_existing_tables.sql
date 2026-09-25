-- Tamzit app on the EXISTING tables of tamzitnews_v1 (owner decision, replaces the app_ content/profile tables).
--
--   editions  -> tamzit_editions (+ tamzit_edition_elements: audio, ad, cta_link, story)
--   items     -> processed_stories linked by 'story' elements, otherwise parsed from main_text
--   profiles  -> user_preferences (id = user_id)
--
-- Existing tables are changed ADDITIVELY ONLY: new nullable columns with defaults, new indexes, one
-- AFTER INSERT trigger on tamzit_editions that never raises. No drops, renames, type changes, value
-- rewrites or RLS policies on them; the app reads them only through the security-definer RPCs below.
-- Idempotent.

-- ===========================================================================
-- 1. Existing tables: additive columns and indexes
-- ===========================================================================

alter table public.user_preferences
  add column if not exists phone            text,
  add column if not exists email            text,
  add column if not exists birth_year       int,
  add column if not exists city             text,
  add column if not exists language         text default 'he',
  add column if not exists audience         text default 'general',
  add column if not exists slot_times       text[] default '{07:30,13:00,20:00}',
  add column if not exists communities      text[] default '{}',
  add column if not exists special_push     boolean default true,
  add column if not exists edition_push     boolean default true,
  add column if not exists headline_in_push boolean default false,
  add column if not exists text_scale       real default 1,
  add column if not exists theme            text default 'system',
  add column if not exists shabbat_city_id  text default 'jerusalem',
  add column if not exists onboarded        boolean default false,
  add column if not exists updated_at       timestamptz default now(),
  add column if not exists last_seen_at     timestamptz;
create unique index if not exists app_user_preferences_phone_key on public.user_preferences (phone) where phone is not null;
create index if not exists app_user_preferences_email_idx on public.user_preferences (lower(email)) where email is not null;

alter table public.processed_stories
  add column if not exists kind         text default 'news',
  add column if not exists community_id text,
  add column if not exists status       text default 'published',
  add column if not exists corrected_at timestamptz,
  add column if not exists versions     jsonb default '{}';

alter table public.tamzit_edition_elements
  add column if not exists story_id bigint references public.processed_stories(id) on delete cascade,
  add column if not exists position int default 0;

create index if not exists app_tamzit_editions_lang_date_idx on public.tamzit_editions (language, edition_date, created_at);
create index if not exists app_tamzit_elements_edition_idx on public.tamzit_edition_elements (edition_id, element_type);
create index if not exists app_tamzit_elements_story_idx on public.tamzit_edition_elements (story_id) where story_id is not null;

-- Our own reference table: keywords that map a section title to a topic (see seed/001_reference.sql).
alter table public.app_topics add column if not exists keywords text[] not null default '{}';

-- ===========================================================================
-- 2. Profiles: copy app_profiles (demo accounts) into user_preferences
-- ===========================================================================

do $$
begin
  if to_regclass('public.app_profiles') is not null then
    insert into public.user_preferences (user_id, created_at, name, persona, anxiety_level, update_frequency, interests,
      phone, email, birth_year, city, language, audience, slot_times, communities, special_push, edition_push,
      headline_in_push, text_scale, theme, shabbat_city_id, onboarded, updated_at, last_seen_at)
    select p.id, p.created_at, p.full_name,
      case p.style when 'calm' then 'Calming' when 'light' then 'Buddy' when 'human' then 'Human' else 'Informative' end,
      case p.level_filter when 'critical' then 'High' when 'general' then 'Low' else 'Medium' end,
      p.frequency, p.topics, p.phone, p.email, p.birth_year, p.city, p.language, p.audience, p.slot_times,
      p.communities, p.special_push, p.edition_push, p.headline_in_push, p.text_scale, p.theme, p.shabbat_city_id,
      p.onboarded, p.updated_at, p.last_seen_at
    from public.app_profiles p
    on conflict (user_id) do nothing;
  end if;
end $$;

-- ===========================================================================
-- 3. Our user tables: point at user_preferences; item ids become text
-- ===========================================================================

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'f'
      and c.conrelid::regclass::text in ('app_family_members', 'app_saved_items', 'app_reads', 'app_feedback',
                                         'app_messages', 'app_devices', 'app_donations')
      and c.confrelid::regclass::text in ('app_profiles', 'app_items')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'app_saved_items' and column_name = 'item_id') = 'uuid' then
    delete from public.app_saved_items;
    alter table public.app_saved_items alter column item_id type text using item_id::text;
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'app_feedback' and column_name = 'item_id') = 'uuid' then
    alter table public.app_feedback alter column item_id type text using item_id::text;
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'app_messages' and column_name = 'item_id') = 'uuid' then
    alter table public.app_messages alter column item_id type text using item_id::text;
  end if;
end $$;

alter table public.app_saved_items add column if not exists snapshot jsonb;  -- FeedItem at save time (fallback)

do $$
declare
  t text;
  col text;
begin
  foreach t in array array['app_family_members:owner_id', 'app_saved_items:profile_id', 'app_reads:profile_id',
                           'app_feedback:profile_id', 'app_messages:profile_id', 'app_devices:profile_id',
                           'app_donations:profile_id'] loop
    col := split_part(t, ':', 2);
    t := split_part(t, ':', 1);
    if not exists (select 1 from pg_constraint where conname = t || '_profile_fk') then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.user_preferences(user_id) on delete cascade',
                     t, t || '_profile_fk', col);
    end if;
  end loop;
end $$;

-- A member sees the family rows that name their phone (policy helper: the caller's own phone only).
create or replace function public.app_my_phone() returns text
language sql stable security definer set search_path = public as $$
  select phone from public.user_preferences where user_id = auth.uid();
$$;
revoke execute on function public.app_my_phone() from public, anon;
grant execute on function public.app_my_phone() to authenticated;

drop policy if exists app_family_member_read on public.app_family_members;
create policy app_family_member_read on public.app_family_members for select to authenticated
  using (member_phone = (select public.app_my_phone()));

-- Push de-duplication: the engine inserts every edition several times (one row per WhatsApp group).
create table if not exists public.app_push_log (
  key         text primary key,              -- 'special:<language>:<md5(main_text)>'
  edition_id  bigint,
  created_at  timestamptz not null default now(),
  pushed_at   timestamptz,
  result      jsonb
);
alter table public.app_push_log enable row level security;
revoke all on public.app_push_log from anon, authenticated;

-- ===========================================================================
-- 4. Drop the duplicate app_ tables and everything built on them
-- ===========================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'app_sample_roll_weekly') then
    perform cron.unschedule('app_sample_roll_weekly');
  end if;
end $$;

drop function if exists public.app_sample_roll_forward();
drop function if exists public.app_edition_view(uuid);
drop function if exists public.app_toggle_save(uuid);
drop function if exists public.app_submit_feedback(uuid, text, text);
drop function if exists public.app_build_feed(uuid, text, text, timestamptz, timestamptz, uuid[], uuid[], boolean, text, timestamptz, timestamptz, uuid);
drop function if exists public.app_item_json(uuid, text, text, text, uuid, boolean, text);
drop function if exists public.app_item_json(uuid, text, text, text, uuid, boolean);
drop function if exists public.app_pick_version(uuid, text, text, text, boolean, text);
drop function if exists public.app_pick_version(uuid, text, text, text, boolean);
drop function if exists public.app_pick_audio(text, text, timestamptz, timestamptz, uuid);
drop function if exists public.app_require_profile();
drop function if exists public.app_engine_upsert_edition(jsonb);

drop table if exists public.app_edition_items, public.app_item_versions, public.app_audio, public.app_ads,
  public.app_editions, public.app_items, public.app_profiles;
drop function if exists public.app_editions_notify_special();
drop function if exists public.app_profiles_guard();
