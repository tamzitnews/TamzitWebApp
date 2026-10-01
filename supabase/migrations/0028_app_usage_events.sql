-- Tamzit app: what readers do in the app, and the numbers the operators see.
--
-- Until now the server knew only what it had to: which editions a reader marked read (app_reads), what they saved,
-- their feedback and their devices. There was no way to answer "how many opened the app today", "do they listen to
-- the spoken edition", "who stopped coming back", "which version is installed".
--
-- (a) app_events: one row per thing that happened in the app (opened, read an edition, played the audio, tapped the
--     ad, saved, shared, searched, finished the tour …). The app sends them in batches through app_track, which
--     accepts only the names below and keeps at most 50 in one call, so a bug or a hostile client cannot fill the
--     table. A reader is identified by their profile; nothing is written for a reader who is not signed in.
-- (b) app_devices gains app_version and app_build: which version is installed, for the dashboard and for
--     "please update" messages.
-- (c) app_analytics: everything the dashboard shows, in one call, for operators only (console_admin_emails).
--
-- Kept small on purpose: no screen-by-screen trail, no location, no device fingerprint. Events older than
-- app_settings.events_keep_days (default 180) are deleted by the hourly housekeeping.
-- Idempotent.

-- (a) ----------------------------------------------------------------------------------------------------------
create table if not exists public.app_events (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null,
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  session_id  text,                               -- one app launch, made up by the app
  app_version text,
  platform    text,
  created_at  timestamptz not null default now()
);
alter table public.app_events enable row level security;
revoke all on public.app_events from anon, authenticated;
create index if not exists app_events_profile_idx on public.app_events (profile_id, created_at desc);
create index if not exists app_events_name_idx on public.app_events (name, created_at desc);
create index if not exists app_events_created_idx on public.app_events (created_at desc);

-- The names the app may send. Anything else is dropped (and counted as 'unknown' in the answer).
create or replace function public.app_event_names() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'app_open',          -- the app came to the front   { cold: bool }
    'session_end',       -- it went to the background   { seconds: int }
    'edition_open',      -- an edition was shown        { edition_id, kind, source: 'push'|'app' }
    'edition_read',      -- the reader reached its end  { edition_id, seconds }
    'item_open',         -- one item was opened         { item_id }
    'audio_play',        -- the spoken edition started  { edition_id }
    'audio_done',        -- it played to the end        { edition_id, seconds }
    'ad_click',          -- the ad or its image         { element_id }
    'item_save', 'item_unsave', 'item_share', 'item_feedback',
    'archive_open', 'search',
    'settings_change',   -- { key }
    'push_open',         -- the app was opened from a notification { type }
    'tour_step', 'tour_done', 'tour_skip',
    'premium_view', 'donate_view'
  ];
$$;

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('events_keep_days', '180'::jsonb, 'כמה זמן נשמרים נתוני השימוש',
   E'מה זה: כמה ימים נשמרות שורות השימוש (app_events): פתיחת האפליקציה, קריאת מהדורה, האזנה, לחיצה על פרסומת וכדומה. שורות ישנות יותר נמחקות אוטומטית פעם בשעה. המספרים בדשבורד מחושבים מהשורות שנשמרו, ולכן טווח קצר יותר מקצר גם את ההיסטוריה שאפשר לראות.\n'
   'על מה זה משפיע: כמה אחורה אפשר להסתכל בדשבורד, וכמה מידע על הקוראים נשמר.\n'
   'איפה זה ממומש: שרת: public.app_housekeeping (מיגרציה 0028).\n'
   'פורמט: מספר שלם של ימים, בין 7 ל-730.',
   'מערכת', 'int', '{"min": 7, "max": 730}'::jsonb, '180'::jsonb, false, false, 5070)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- The app sends a batch: [{name, props, at, session_id, app_version, platform}, …]. Returns how many were written.
create or replace function public.app_track(p_events jsonb) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_names text[] := public.app_event_names();
  v_n int;
begin
  if v_uid is null or jsonb_typeof(p_events) is distinct from 'array' then
    return 0;
  end if;
  with e as (
    select x
    from jsonb_array_elements(p_events) with ordinality as t(x, i)
    where i <= 50
  )
  insert into public.app_events (profile_id, name, props, session_id, app_version, platform, created_at)
  select v_uid,
         x ->> 'name',
         case when jsonb_typeof(x -> 'props') = 'object' then x -> 'props' else '{}'::jsonb end,
         left(nullif(x ->> 'session_id', ''), 64),
         left(nullif(x ->> 'app_version', ''), 32),
         case when x ->> 'platform' in ('android', 'ios', 'web') then x ->> 'platform' end,
         least(coalesce((x ->> 'at')::timestamptz, now()), now())
  from e
  where x ->> 'name' = any(v_names)
    and pg_column_size(coalesce(x -> 'props', '{}'::jsonb)) <= 2048;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.app_track(jsonb) from public, anon;
grant execute on function public.app_track(jsonb) to authenticated, service_role;
revoke execute on function public.app_event_names() from public, anon, authenticated;
grant execute on function public.app_event_names() to service_role;

-- (b) ----------------------------------------------------------------------------------------------------------
alter table public.app_devices add column if not exists app_version text;
alter table public.app_devices add column if not exists app_build int;

-- Same as before, plus the installed version (both arguments optional, so older builds keep working). The two-argument
-- version is dropped: with both installed, PostgREST cannot choose between them (PGRST203).
drop function if exists public.app_register_device(text, text);
create or replace function public.app_register_device(p_token text, p_platform text,
                                                      p_app_version text default null, p_app_build int default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
begin
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception using errcode = 'P0001', message = 'invalid_platform';
  end if;
  if p_token is null or length(btrim(p_token)) not between 1 and 4096 then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_devices (profile_id, push_token, platform, app_version, app_build)
  values (v_prof.user_id, btrim(p_token), p_platform, left(nullif(btrim(coalesce(p_app_version, '')), ''), 32), p_app_build)
  on conflict (push_token) do update set
    profile_id = excluded.profile_id, platform = excluded.platform, last_seen_at = now(),
    app_version = coalesce(excluded.app_version, public.app_devices.app_version),
    app_build = coalesce(excluded.app_build, public.app_devices.app_build);
end;
$$;

revoke execute on function public.app_register_device(text, text, text, int) from public, anon;
grant execute on function public.app_register_device(text, text, text, int) to authenticated, service_role;

-- (c) ----------------------------------------------------------------------------------------------------------
-- Everything the dashboard shows, in one call. p_days: the window for the per-reader numbers (default 30).
create or replace function public.app_analytics(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
  v_from timestamptz := now() - make_interval(days => v_days);
begin
  if v_uid is null or not public.app_is_console_admin(v_uid) then
    raise exception using errcode = 'P0001', message = 'not_an_operator';
  end if;

  return jsonb_build_object(
    'days', v_days,
    'generated_at', now(),

    -- how many people there are, and how many are still coming back
    'people', (
      with act as (
        select p.user_id, p.created_at,
               greatest(p.last_seen_at, (select max(e.created_at) from public.app_events e where e.profile_id = p.user_id)) as seen
        from public.user_preferences p
        where exists (select 1 from auth.users u where u.id = p.user_id)   -- app accounts; the service's older rows are not
      )
      select jsonb_build_object(
        'registered', (select count(*) from act),
        'legacy_profiles', (select count(*) from public.user_preferences p
                            where not exists (select 1 from auth.users u where u.id = p.user_id)),
        'with_device', (select count(distinct profile_id) from public.app_devices),
        'devices', (select count(*) from public.app_devices),
        'active_today', (select count(*) from act where seen >= now() - interval '1 day'),
        'active_7d', (select count(*) from act where seen >= now() - interval '7 days'),
        'active_30d', (select count(*) from act where seen >= now() - interval '30 days'),
        'new_7d', (select count(*) from act where created_at >= now() - interval '7 days'),
        'at_risk', (select count(*) from act where seen between now() - interval '14 days' and now() - interval '7 days'),
        'churned', (select count(*) from act where seen < now() - interval '14 days'),
        'never_opened', (select count(*) from act where seen is null))
    ),

    -- which version people are on
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object('version', v, 'build', b, 'devices', n) order by n desc), '[]'::jsonb)
      from (select coalesce(app_version, '—') as v, app_build as b, count(*) as n
            from public.app_devices group by 1, 2) x
    ),

    -- what happened in the window
    'events', (
      select coalesce(jsonb_object_agg(name, n), '{}'::jsonb)
      from (select name, count(*) as n from public.app_events where created_at >= v_from group by 1) x
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d::date, 'people', coalesce(p, 0), 'opens', coalesce(o, 0), 'editions', coalesce(r, 0)) order by d), '[]'::jsonb)
      from generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') d
      left join lateral (
        select count(distinct e.profile_id) as p,
               count(*) filter (where e.name = 'app_open') as o,
               count(*) filter (where e.name = 'edition_read') as r
        from public.app_events e
        where e.created_at >= d and e.created_at < d + interval '1 day') s on true
    ),
    'engagement', jsonb_build_object(
      'audio_plays', (select count(*) from public.app_events where name = 'audio_play' and created_at >= v_from),
      'audio_listeners', (select count(distinct profile_id) from public.app_events where name = 'audio_play' and created_at >= v_from),
      'ad_clicks', (select count(*) from public.app_events where name = 'ad_click' and created_at >= v_from),
      'ad_clickers', (select count(distinct profile_id) from public.app_events where name = 'ad_click' and created_at >= v_from),
      'saves', (select count(*) from public.app_events where name = 'item_save' and created_at >= v_from),
      'shares', (select count(*) from public.app_events where name = 'item_share' and created_at >= v_from),
      'searches', (select count(*) from public.app_events where name = 'search' and created_at >= v_from),
      'editions_read', (select count(*) from public.app_reads where read_at >= v_from),
      'minutes', (select round(coalesce(sum((props ->> 'seconds')::numeric), 0) / 60.0)
                  from public.app_events where name = 'session_end' and created_at >= v_from
                    and (props ->> 'seconds') ~ '^[0-9]+$'),
      'tour_done', (select count(distinct profile_id) from public.app_events where name = 'tour_done'),
      'tour_skip', (select count(distinct profile_id) from public.app_events where name = 'tour_skip')
    ),

    -- one row per reader, newest first
    'readers', (
      select coalesce(jsonb_agg(r order by r ->> 'seen' desc nulls last), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'name', coalesce(nullif(btrim(p.name), ''), '—'),
          'joined', p.created_at,
          'lang', p.language,
          'audience', p.audience,
          'plan', case when public.app_is_premium(p.user_id) then 'premium' else 'free' end,
          'devices', (select count(*) from public.app_devices d where d.profile_id = p.user_id),
          'version', (select d.app_version from public.app_devices d where d.profile_id = p.user_id
                      order by d.last_seen_at desc limit 1),
          'push', (select count(*) > 0 from public.app_devices d where d.profile_id = p.user_id),
          'seen', greatest(p.last_seen_at, (select max(e.created_at) from public.app_events e where e.profile_id = p.user_id)),
          'opens', (select count(*) from public.app_events e where e.profile_id = p.user_id and e.name = 'app_open' and e.created_at >= v_from),
          'editions', (select count(*) from public.app_reads a where a.profile_id = p.user_id and a.read_at >= v_from),
          'minutes', (select round(coalesce(sum((e.props ->> 'seconds')::numeric), 0) / 60.0)
                      from public.app_events e where e.profile_id = p.user_id and e.name = 'session_end'
                        and e.created_at >= v_from and (e.props ->> 'seconds') ~ '^[0-9]+$'),
          'audio', (select count(*) from public.app_events e where e.profile_id = p.user_id and e.name = 'audio_play' and e.created_at >= v_from),
          'ads', (select count(*) from public.app_events e where e.profile_id = p.user_id and e.name = 'ad_click' and e.created_at >= v_from),
          'saved', (select count(*) from public.app_saved_items si where si.profile_id = p.user_id)
        ) as r
        from public.user_preferences p
        where exists (select 1 from auth.users u where u.id = p.user_id)
        limit 500
      ) x
    )
  );
end;
$$;

revoke execute on function public.app_analytics(int) from public, anon;
grant execute on function public.app_analytics(int) to authenticated, service_role;

-- Housekeeping also drops old events (as in migration 0019, plus this).
create or replace function public.app_housekeeping() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.app_media m
             where m.status = 'ok' and m.kind in ('audio', 'video')
               and m.created_at < now() - make_interval(hours =>
                     least(greatest(public.app_setting_int('english_audio_keep_hours', 24), 1), 24))) then
    perform public.app_media_kick();
  end if;
  if exists (select 1 from public.app_item_labels l where l.status = 'failed' and l.next_try_at <= now() and l.tries < 6) then
    perform public.app_label_kick();
  end if;
  delete from public.app_events
  where created_at < now() - make_interval(days => least(greatest(public.app_setting_int('events_keep_days', 180), 7), 730));
end;
$$;

revoke execute on function public.app_housekeeping() from public, anon, authenticated;
