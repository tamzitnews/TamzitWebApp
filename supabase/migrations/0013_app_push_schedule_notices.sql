-- Tamzit app: pushes when an edition is published, the service schedule as data, the newest-edition mode and
-- notices.
--
-- (a) Push on publish: the AFTER INSERT trigger on tamzit_editions now claims one push per regular edition
--     (language + track + slot + day), not only per special update, and calls the app-push edge function. The
--     app no longer schedules local notifications at fixed times.
-- (b) Which editions a reader gets (app_reader_track / app_edition_is_own): youth → teens, one a day → daily,
--     two or three a day → classic; when the language has had no edition of that track for 14 days, the fallback
--     track (teens → classic, daily → classic, classic → daily). Two a day: morning and evening (on a day that
--     ends in Shabbat or Yom Tov: morning and noon, the last one before it). One a day on the classic fallback:
--     the last edition of the day.
-- (c) The service schedule is data: app_settings.edition_schedule (times, editions per kind of day, Motzei
--     Shabbat timing) and app_calendar_days (chol hamoed, filled by supabase/scripts/gen_rest_periods.mjs). On
--     chol hamoed there are two editions (morning, evening).
-- (d) app_personal_edition() with no window = the reader's newest edition (plus special updates since the one
--     before it), with next_edition (what comes next and roughly when) and edition_id. Explicit windows still work
--     (installed apps).
-- (e) Notices: the "קוראים יקרים" / "Dear readers" / "Chers lecteurs" block of an edition ("the next edition
--     will be sent on Motzei Shabbat…") → Feed.notices, shown small at the top.
-- Idempotent.

-- ===========================================================================
-- Settings and calendar
-- ===========================================================================

insert into public.app_settings (key, value) values ('edition_schedule', '{
  "times": {"morning": "09:00", "noon": "15:00", "evening": "21:00"},
  "days": {"weekday": ["morning", "noon", "evening"], "chol_hamoed": ["morning", "evening"]},
  "erev_lead_min": 60,
  "motzash_after_min": 60,
  "motzash_not_before": "21:00",
  "languages": {
    "en": {"times": {"morning": "09:30", "noon": "15:30", "evening": "21:45"}},
    "fr": {"times": {"morning": "09:30", "noon": "15:30", "evening": "21:45", "daily": "19:30"}}
  },
  "daily_time": "21:00"
}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.app_calendar_days (
  day  date primary key,
  kind text not null,          -- chol_hamoed (more kinds can be added with their own entry in edition_schedule.days)
  name text
);
alter table public.app_calendar_days enable row level security;
revoke all on public.app_calendar_days from anon, authenticated;
grant select on public.app_calendar_days to anon, authenticated;
drop policy if exists app_calendar_days_read on public.app_calendar_days;
create policy app_calendar_days_read on public.app_calendar_days for select to anon, authenticated using (true);

-- Chol hamoed in Israel until the generator runs (it overwrites these): Sukkot 16–20 Tishrei, Pesach 16–20 Nisan.
insert into public.app_calendar_days (day, kind, name) values
  ('2026-09-27', 'chol_hamoed', 'Sukkot'), ('2026-09-28', 'chol_hamoed', 'Sukkot'), ('2026-09-29', 'chol_hamoed', 'Sukkot'),
  ('2026-09-30', 'chol_hamoed', 'Sukkot'), ('2026-10-01', 'chol_hamoed', 'Sukkot'),
  ('2027-04-23', 'chol_hamoed', 'Pesach'), ('2027-04-24', 'chol_hamoed', 'Pesach'), ('2027-04-25', 'chol_hamoed', 'Pesach'),
  ('2027-04-26', 'chol_hamoed', 'Pesach'), ('2027-04-27', 'chol_hamoed', 'Pesach')
on conflict (day) do nothing;

-- Default slot times per frequency (the column default and the app use the same; 0009 still had 07:30/13:00/20:00).
-- They no longer drive notifications (pushes go out when an edition is published) but stay in the profile.
create or replace function public.app_default_slots(p_frequency int) returns text[]
language sql immutable set search_path = public as $$
  select case public.app_frequency_of(p_frequency) when 1 then array['21:30'] when 2 then array['10:00', '21:30']
    else array['10:00', '16:00', '21:30'] end;
$$;

-- A jsonb object setting (or '{}').
create or replace function public.app_setting_json(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select s.value from public.app_settings s where s.key = p_key and jsonb_typeof(s.value) = 'object'),
                  '{}'::jsonb);
$$;

-- ===========================================================================
-- Which editions a reader gets
-- ===========================================================================

-- Does a rest period (Shabbat / Yom Tov) start on this Israeli civil date (Jerusalem times)?
create or replace function public.app_rest_starts_on(p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_rest_periods r
                 where r.city_id = 'jerusalem' and (r.starts_at at time zone 'Asia/Jerusalem')::date = p_day);
$$;

-- The reader's track: preferred (youth → teens, one a day → daily, else classic), or its fallback when the language
-- has had no edition of the preferred track in the last 14 days.
create or replace function public.app_reader_track(p_lang text, p_aud text, p_freq int) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_pref text := case when p_aud = 'youth' then 'teens'
                      when public.app_frequency_of(p_freq) = 1 then 'daily' else 'classic' end;
  v_fallbacks text[] := case v_pref when 'teens' then array['classic', 'daily']
                                    when 'daily' then array['classic'] else array['daily'] end;
  t text;
begin
  foreach t in array array[v_pref] || v_fallbacks loop
    if exists (select 1 from public.tamzit_editions e
               where e.language = public.app_lang_name(p_lang) and public.app_edition_track(e.edition_type) = t
                 and e.created_at > now() - interval '14 days') then
      return t;
    end if;
  end loop;
  return v_pref;
end;
$$;

-- Is an edition (track, slot, day) one the reader gets? p_track: classic | daily | teens | special; p_slot: morning |
-- noon | evening | daily | special.
create or replace function public.app_edition_is_own(p_lang text, p_aud text, p_freq int,
                                                     p_track text, p_slot text, p_day date) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_track text := public.app_reader_track(p_lang, p_aud, p_freq);
  v_freq int := public.app_frequency_of(p_freq);
begin
  if p_track = 'special' or p_track is distinct from v_track then
    return false;
  end if;
  if v_track = 'daily' or v_freq = 3 then
    return true;
  end if;
  if v_freq = 2 then
    return p_slot in ('morning', 'evening') or (p_slot = 'noon' and public.app_rest_starts_on(p_day));
  end if;
  -- one a day on a classic / teens track: the last edition of the day
  return p_slot = 'evening' or (p_slot = 'noon' and public.app_rest_starts_on(p_day));
end;
$$;

-- The reader's editions in (p_from, p_to] (special updates not included).
create or replace function public.app_reader_own_editions(p_lang text, p_aud text, p_freq int,
                                                          p_from timestamptz, p_to timestamptz)
returns table (id bigint, published_at timestamptz, edition_date date, track text, slot text,
               edition_type text, time_slot text, main_text text)
language sql stable security definer set search_path = public as $$
  select w.id, w.published_at, w.edition_date, w.track, w.slot, w.edition_type, w.time_slot, w.main_text
  from public.app_editions_window(p_lang, p_from, p_to) w
  where w.track <> 'special'
    and public.app_edition_is_own(p_lang, p_aud, p_freq, w.track, w.slot, w.edition_date);
$$;

-- ===========================================================================
-- Next edition
-- ===========================================================================

-- What the reader gets next and roughly when: { type: morning|noon|evening|motzash, at }. Uses edition_schedule,
-- app_calendar_days and the reader's rest periods. p_after = the newest edition shown (a slot counts only if it is
-- due more than an hour after it, so the edition just published is not announced again).
create or replace function public.app_next_edition(p_prof public.user_preferences, p_after timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_sched jsonb := public.app_setting_json('edition_schedule');
  v_lang text := coalesce(public.app_lang_code(p_prof.language), 'he');
  v_aud text := case when p_prof.audience = 'youth' then 'youth' else 'general' end;
  v_track text := public.app_reader_track(v_lang, v_aud, p_prof.update_frequency);
  v_times jsonb := coalesce(v_sched -> 'times', '{}') || coalesce(v_sched -> 'languages' -> v_lang -> 'times', '{}');
  v_days jsonb := coalesce(v_sched -> 'days', '{}') || coalesce(v_sched -> 'languages' -> v_lang -> 'days', '{}');
  v_lead interval := make_interval(mins => coalesce((v_sched ->> 'erev_lead_min')::int, 60));
  v_after_rest interval := make_interval(mins => coalesce((v_sched ->> 'motzash_after_min')::int, 60));
  v_not_before time := coalesce(v_sched ->> 'motzash_not_before', '21:00')::time;
  v_city text := coalesce(p_prof.shabbat_city_id, 'jerusalem');
  v_floor timestamptz := greatest(now() - interval '2 hours', coalesce(p_after, now() - interval '1 day') + interval '1 hour');
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_day date;
  v_kind text;
  v_slots text[];
  v_slot text;
  v_at timestamptz;
  v_best timestamptz;
  v_best_type text;
  r record;
begin
  for d in 0 .. 4 loop
    v_day := v_today + d;
    v_kind := coalesce((select c.kind from public.app_calendar_days c where c.day = v_day), 'weekday');
    if v_track = 'daily' then
      v_slots := array['daily'];
    else
      select coalesce(array_agg(x.v), array['morning', 'noon', 'evening'])
      into v_slots from jsonb_array_elements_text(coalesce(v_days -> v_kind, v_days -> 'weekday')) as x(v);
    end if;

    foreach v_slot in array v_slots loop
      v_at := ((v_day + coalesce(v_times ->> v_slot, v_sched ->> 'daily_time', '21:00')::time)
               at time zone 'Asia/Jerusalem');
      -- daily on a day that ends in Shabbat / Yom Tov: at noon
      if v_slot = 'daily' and public.app_rest_starts_on(v_day) then
        v_at := (v_day + coalesce(v_times ->> 'noon', '15:00')::time) at time zone 'Asia/Jerusalem';
      end if;
      continue when v_at <= v_floor;
      continue when exists (select 1 from public.app_rest_periods rp
                            where rp.city_id = v_city and v_at >= rp.starts_at - v_lead and v_at < rp.ends_at);
      continue when v_slot <> 'daily'
                and not public.app_edition_is_own(v_lang, v_aud, p_prof.update_frequency, v_track, v_slot, v_day);
      if v_best is null or v_at < v_best then
        v_best := v_at;
        v_best_type := case when v_slot = 'daily' then 'evening' else v_slot end;
      end if;
    end loop;

    -- Motzei Shabbat / Motzei Chag
    for r in select rp.ends_at from public.app_rest_periods rp
             where rp.city_id = v_city and (rp.ends_at at time zone 'Asia/Jerusalem')::date = v_day loop
      v_at := greatest(r.ends_at + v_after_rest, (v_day + v_not_before) at time zone 'Asia/Jerusalem');
      if v_at > v_floor and (v_best is null or v_at < v_best) then
        v_best := v_at;
        v_best_type := 'motzash';
      end if;
    end loop;

    exit when v_best is not null;
  end loop;

  if v_best is null then
    return null;
  end if;
  return jsonb_build_object('type', v_best_type, 'at', v_best);
end;
$$;

-- ===========================================================================
-- Notices ("קוראים יקרים, המהדורה הבאה תישלח…")
-- ===========================================================================

-- The edition's notices to readers: in each block between '•   •   •' separators, from a line that opens with
-- "קוראים יקרים" / "Dear readers" / "Chers lecteurs" / "מערכת תמצית החדשות" to the end of the block; or a block
-- about the next edition ("המהדורה הבאה", "next update", "prochaine édition") that has no news in it. Markup removed.
create or replace function public.app_edition_notices(p_text text) returns text[]
language plpgsql immutable set search_path = public as $$
declare
  v_blocks text[] := regexp_split_to_array(replace(coalesce(p_text, ''), E'\r', ''),
                                           E'\\n[[:space:]]*•([[:space:]]+•)+[[:space:]]*(\\n|$)');
  v_out text[] := '{}';
  b text;
  v_lines text[];
  v_start int;
  v_text text;
  c_greet constant text := '^[*_[:space:]]*(קוראים יקרים|קוראות וקוראים יקרים|קוראינו היקרים|dear readers|chers lecteurs|מערכת \*?תמצית החדשות)';
  c_next constant text := '(המהדורה הבאה|העדכון הבא|next (update|edition)|prochaine [ée]dition)';
begin
  foreach b in array v_blocks loop
    v_lines := regexp_split_to_array(b, E'\n');
    v_start := null;
    for i in 1 .. cardinality(v_lines) loop
      if v_lines[i] ~* c_greet then
        v_start := i;
        exit;
      end if;
    end loop;
    if v_start is null and b ~* c_next and b !~ '📌' and b !~ '(^|\n)[[:space:]]*•' then
      v_start := 1;
    end if;
    continue when v_start is null;
    v_text := array_to_string(
      array(select l from unnest(v_lines[v_start:]) l
            where l !~ '^[[:space:]]*📻' and l !~* '(מהדורת|edition|édition).*[0-9]{4}[[:space:]]*$'),
      E'\n');
    v_text := public.app_wa_clean(v_text);
    if v_text <> '' then
      v_out := v_out || left(v_text, 700);
    end if;
    exit when cardinality(v_out) >= 2;
  end loop;
  return v_out;
end;
$$;

-- ===========================================================================
-- Personal edition: newest-edition mode
-- ===========================================================================

create or replace function public.app_personal_edition(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_lang text := coalesce(public.app_lang_code(v_prof.language), 'he');
  v_aud text := case when v_prof.audience = 'youth' then 'youth' else 'general' end;
  v_auto boolean := p_from is null and p_to is null;
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := coalesce(p_from, coalesce(p_to, now()) - interval '24 hours');
  v_days int := public.app_setting_int('free_archive_days', 7);
  v_regular bigint[];
  v_specials bigint[];
  v_types jsonb;
  v_title text;
  v_newest_id bigint;
  v_newest_at timestamptz;
  v_prev timestamptz;
  v_feed jsonb;
begin
  if v_auto then
    -- the reader's newest edition, and the special updates since the edition before it
    select r.id, r.published_at into v_newest_id, v_newest_at
    from public.app_reader_own_editions(v_lang, v_aud, v_prof.update_frequency, now() - interval '8 days', now()) r
    order by r.published_at desc limit 1;
    if v_newest_id is not null then
      select max(r.published_at) into v_prev
      from public.app_reader_own_editions(v_lang, v_aud, v_prof.update_frequency,
                                          v_newest_at - interval '8 days', v_newest_at - interval '1 second') r;
      v_from := greatest(coalesce(v_prev, v_newest_at - interval '24 hours'), now() - interval '72 hours');
      v_to := now();
    end if;
  else
    if v_from < now() - make_interval(days => v_days) - interval '10 minutes'
       and not public.app_is_premium(v_prof.user_id) then
      raise exception using errcode = 'P0001', message = 'archive_locked';
    end if;
    -- The newest window: editions already published after the slot → show them now, not at the next slot.
    if p_to is not null and p_to < now() and p_to > now() - interval '26 hours'
       and exists (
         select 1
         from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, p_to, now()) r
         where r.track <> 'special'
           and (public.app_frequency_of(v_prof.update_frequency) > 1 or v_aud = 'youth' or r.track = 'daily')) then
      v_from := p_to;
      v_to := now();
    end if;
  end if;

  if v_auto and v_newest_id is not null then
    v_regular := array[v_newest_id];
    select coalesce(array_agg(w.id order by w.published_at desc), '{}') into v_specials
    from public.app_editions_window(v_lang, v_from, v_to) w where w.track = 'special';
  else
    select coalesce(array_agg(r.id order by r.published_at desc) filter (where r.track <> 'special'), '{}'),
           coalesce(array_agg(r.id order by r.published_at desc) filter (where r.track = 'special'), '{}')
    into v_regular, v_specials
    from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, v_from, v_to) r;
  end if;

  select coalesce(jsonb_agg(x.k order by x.mx desc), '[]'::jsonb) into v_types
  from (
    select public.app_edition_kind(e.edition_type, e.time_slot, public.app_edition_title(e.main_text)) as k,
           max(e.created_at) as mx
    from public.tamzit_editions e
    where e.id = any(case when cardinality(v_regular) > 0 then v_regular else v_specials end)
    group by 1
  ) x;

  if cardinality(v_regular) = 1 then
    select public.app_edition_title(e.main_text) into v_title from public.tamzit_editions e where e.id = v_regular[1];
  end if;

  v_feed := public.app_build_feed(v_prof, v_lang, v_aud, v_from, v_to, v_regular, v_specials, true, v_title, v_types);
  return v_feed || jsonb_build_object(
    'edition_id', case when cardinality(v_regular) > 0 then v_regular[1]::text end,
    'notices', coalesce(public.app_feed_notices(v_regular), '[]'::jsonb),
    'next_edition', public.app_next_edition(
      v_prof, (select max(e.created_at) from public.tamzit_editions e where e.id = any(v_regular))));
end;
$$;

-- ===========================================================================
-- Notices of a feed (its newest regular edition) and the edition view
-- ===========================================================================

create or replace function public.app_feed_notices(p_regular bigint[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(to_jsonb(public.app_edition_notices(e.main_text)), '[]'::jsonb)
  from public.tamzit_editions e
  where e.id = any(coalesce(p_regular, '{}'))
  order by e.created_at desc
  limit 1;
$$;

create or replace function public.app_edition_view(p_edition_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_days int := public.app_setting_int('free_archive_days', 7);
  e public.tamzit_editions;
  v_lang text;
  v_aud text;
  v_prev timestamptz;
  v_from timestamptz;
  v_title text;
begin
  select * into e from public.tamzit_editions t where t.id = p_edition_id and t.created_at <= now();
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if e.created_at < now() - make_interval(days => v_days) and not public.app_is_premium(v_prof.user_id) then
    raise exception using errcode = 'P0001', message = 'archive_locked';
  end if;
  v_lang := coalesce(public.app_lang_code(e.language), 'he');
  v_aud := case when e.edition_type = 'teens' then 'youth' else 'general' end;
  v_title := public.app_edition_title(e.main_text);

  select max(t.created_at) into v_prev
  from public.tamzit_editions t
  where t.language = e.language and t.edition_type = e.edition_type and t.edition_type <> 'special_update'
    and t.created_at < e.created_at - interval '10 minutes';
  v_from := greatest(coalesce(v_prev, e.created_at - interval '24 hours'), e.created_at - interval '72 hours');

  return public.app_build_feed(
    v_prof, v_lang, v_aud, v_from, e.created_at,
    case when e.edition_type = 'special_update' then '{}'::bigint[] else array[e.id] end,
    case when e.edition_type = 'special_update' then array[e.id] else '{}'::bigint[] end,
    false, v_title, jsonb_build_array(public.app_edition_kind(e.edition_type, e.time_slot, v_title)))
    || jsonb_build_object('edition_id', e.id::text,
                          'notices', coalesce(public.app_feed_notices(array[e.id]), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- Push on publish
-- ===========================================================================

-- Push payload: language, kind, title, slot, the first item's text.
create or replace function public.app_push_payload(p_edition_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'edition_id', e.id,
    'language', public.app_lang_code(e.language),
    'edition_type', e.edition_type,
    'track', public.app_edition_track(e.edition_type),
    'slot', public.app_edition_slot(e.edition_type, e.time_slot),
    'kind', public.app_edition_kind(e.edition_type, e.time_slot, public.app_edition_title(e.main_text)),
    'edition_date', e.edition_date,
    'created_at', e.created_at,
    'title', public.app_edition_title(e.main_text),
    'headline', (select coalesce(nullif(i.item ->> 'headline', ''), left(i.item ->> 'body', 140))
                 from public.app_edition_items(e.id, public.app_lang_code(e.language), 'general', 'informative', null) i
                 order by i.pos limit 1))
  from public.tamzit_editions e where e.id = p_edition_id;
$$;

-- Devices to notify about a regular edition: edition_push on, the edition's language, and an edition the reader
-- gets (app_edition_is_own). One row per device.
create or replace function public.app_push_edition_targets(p_edition_id bigint)
returns table (push_token text, headline_in_push boolean, shabbat_city_id text)
language sql stable security definer set search_path = public as $$
  select d.push_token, coalesce(p.headline_in_push, false), coalesce(p.shabbat_city_id, 'jerusalem')
  from public.tamzit_editions e
  join public.user_preferences p on public.app_lang_code(p.language) = public.app_lang_code(e.language)
  join public.app_devices d on d.profile_id = p.user_id
  where e.id = p_edition_id and e.edition_type <> 'special_update'
    and coalesce(p.edition_push, true)
    and public.app_edition_is_own(public.app_lang_code(e.language),
                                  case when p.audience = 'youth' then 'youth' else 'general' end,
                                  p.update_frequency,
                                  public.app_edition_track(e.edition_type),
                                  public.app_edition_slot(e.edition_type, e.time_slot),
                                  e.edition_date);
$$;

-- AFTER INSERT on tamzit_editions: one push per distinct special update and one per regular edition (language, track,
-- slot, day: the engine inserts each edition several times). Never raises.
create or replace function public.app_tamzit_editions_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
  v_key text;
begin
  begin
    if new.created_at < now() - interval '2 hours' then
      return new;
    end if;
    if new.edition_type = 'special_update' then
      v_key := 'special:' || coalesce(new.language, '') || ':' || md5(coalesce(new.main_text, ''));
    else
      v_key := 'edition:' || coalesce(new.language, '') || ':' || public.app_edition_track(new.edition_type) || ':'
               || public.app_edition_slot(new.edition_type, new.time_slot) || ':' || coalesce(new.edition_date::text, '');
    end if;
    insert into public.app_push_log (key, edition_id) values (v_key, new.id) on conflict (key) do nothing;
    if not found then
      return new;
    end if;
    v_url := public.app_setting_text('functions_base_url');
    v_secret := public.app_setting_text('push_webhook_secret');
    if v_url is null then
      return new;
    end if;
    perform net.http_post(
      url := rtrim(v_url, '/') || '/app-push',
      body := jsonb_build_object('edition_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-app-secret', coalesce(v_secret, '')),
      timeout_milliseconds := 30000);
  exception when others then
    raise warning 'app_tamzit_editions_push: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists app_tamzit_editions_push on public.tamzit_editions;
create trigger app_tamzit_editions_push
  after insert on public.tamzit_editions
  for each row execute function public.app_tamzit_editions_push();

-- ===========================================================================
-- Privileges (same rules as 0009)
-- ===========================================================================

do $$
declare
  f record;
  client_rpcs constant text[] := array['app_me', 'app_personal_edition', 'app_edition_view', 'app_archive',
    'app_search', 'app_saved', 'app_toggle_save', 'app_mark_read', 'app_submit_feedback', 'app_update_profile',
    'app_family_invite', 'app_family_remove', 'app_register_device', 'app_record_donation', 'app_my_phone'];
  server_rpcs constant text[] := array['app_engine_upsert_edition', 'app_push_payload', 'app_is_premium',
    'app_plan_info', 'app_setting_text', 'app_setting_int', 'app_normalize_phone', 'app_parse_edition',
    'app_edition_title', 'app_editions_window', 'app_media_queue', 'app_edition_audio', 'app_section_split',
    'app_push_edition_targets', 'app_edition_notices', 'app_next_edition', 'app_reader_track'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'app\_%'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname = any(client_rpcs) then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
      if f.proname = any(server_rpcs) then
        execute format('grant execute on function %s to service_role', f.sig);
      end if;
    end if;
  end loop;
end $$;
