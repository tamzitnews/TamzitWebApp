-- Tamzit app: feed, parsing and profile RPCs on the existing tables (see 0008 and docs/api-contract.md).
-- All client RPCs are security definer, set search_path = public, and raise
-- `raise exception using errcode = 'P0001', message = '<code>'`. Idempotent (create or replace).

-- ===========================================================================
-- Small helpers
-- ===========================================================================

create or replace function public.app_lang_code(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(coalesce(p, '')) when 'hebrew' then 'he' when 'english' then 'en' when 'french' then 'fr'
    when 'he' then 'he' when 'en' then 'en' when 'fr' then 'fr' else null end;
$$;

create or replace function public.app_lang_name(p text) returns text
language sql immutable set search_path = public as $$
  select case lower(coalesce(p, '')) when 'he' then 'hebrew' when 'en' then 'english' when 'fr' then 'french'
    when 'hebrew' then 'hebrew' when 'english' then 'english' when 'french' then 'french' else null end;
$$;

-- user_preferences <-> contract values
create or replace function public.app_style_of(p_persona text) returns text
language sql immutable set search_path = public as $$
  select case p_persona when 'Calming' then 'calm' when 'Buddy' then 'light' when 'Human' then 'human' else 'informative' end;
$$;
create or replace function public.app_persona_of(p_style text) returns text
language sql immutable set search_path = public as $$
  select case p_style when 'calm' then 'Calming' when 'light' then 'Buddy' when 'human' then 'Human' else 'Informative' end;
$$;
create or replace function public.app_level_of(p_anxiety text) returns text
language sql immutable set search_path = public as $$
  select case p_anxiety when 'High' then 'critical' when 'Low' then 'general' else 'important' end;
$$;
create or replace function public.app_anxiety_of(p_level text) returns text
language sql immutable set search_path = public as $$
  select case p_level when 'critical' then 'High' when 'general' then 'Low' else 'Medium' end;
$$;
create or replace function public.app_frequency_of(p int) returns int
language sql immutable set search_path = public as $$
  select least(greatest(coalesce(p, 3), 1), 3);
$$;
create or replace function public.app_default_slots(p_frequency int) returns text[]
language sql immutable set search_path = public as $$
  select case public.app_frequency_of(p_frequency) when 1 then array['20:00'] when 2 then array['07:30', '20:00']
    else array['07:30', '13:00', '20:00'] end;
$$;

-- The contract profile JSON from a user_preferences row.
create or replace function public.app_profile_json(p public.user_preferences) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.user_id,
    'full_name', coalesce(p.name, ''),
    'phone', p.phone,
    'email', p.email,
    'birth_year', p.birth_year,
    'city', p.city,
    'language', coalesce(p.language, 'he'),
    'audience', coalesce(p.audience, 'general'),
    'frequency', public.app_frequency_of(p.update_frequency),
    'slot_times', case when cardinality(p.slot_times) = public.app_frequency_of(p.update_frequency) then p.slot_times
                       else public.app_default_slots(p.update_frequency) end,
    'level_filter', public.app_level_of(p.anxiety_level),
    'style', public.app_style_of(p.persona),
    'topics', coalesce(p.interests, '{}'),
    'communities', coalesce(p.communities, '{}'),
    'special_push', coalesce(p.special_push, true),
    'edition_push', coalesce(p.edition_push, true),
    'headline_in_push', coalesce(p.headline_in_push, false),
    'text_scale', coalesce(p.text_scale, 1),
    'theme', coalesce(p.theme, 'system'),
    'shabbat_city_id', coalesce(p.shabbat_city_id, 'jerusalem'),
    'onboarded', coalesce(p.onboarded, false),
    'created_at', p.created_at,
    'updated_at', coalesce(p.updated_at, p.created_at),
    'last_seen_at', p.last_seen_at
  );
$$;

-- ===========================================================================
-- WhatsApp text parsing
-- ===========================================================================

-- Strips WhatsApp markup (*bold*, _italic_, ~strike~) and extra spaces; keeps line breaks.
create or replace function public.app_wa_clean(p text) returns text
language plpgsql immutable set search_path = public as $$
declare
  s text := coalesce(p, '');
begin
  s := regexp_replace(s, '(^|[[:space:](])_([^_\n]+)_(?=$|[[:space:].,:;!?)])', '\1\2', 'g');
  s := replace(s, '*', '');
  s := regexp_replace(s, '~([^~\n]+)~', '\1', 'g');
  s := regexp_replace(s, '[ \t]+', ' ', 'g');
  s := regexp_replace(s, '[ \t]*\n[ \t]*', E'\n', 'g');
  s := regexp_replace(s, '\n{2,}', E'\n', 'g');
  return btrim(s, E' \t\n');
end;
$$;

-- Google Drive "view" link -> direct download link (playable); other URLs unchanged.
create or replace function public.app_drive_direct(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p ~ 'drive\.google\.com/file/d/[^/?#]+' then
      'https://drive.google.com/uc?export=download&id=' || (regexp_match(p, 'drive\.google\.com/file/d/([^/?#]+)'))[1]
    when p ~ 'drive\.google\.com/(open|uc)\?(.*&)?id=[^&#]+' then
      'https://drive.google.com/uc?export=download&id=' || (regexp_match(p, '[?&]id=([^&#]+)'))[1]
    else p end;
$$;

-- Edition name from the header ("מהדורת בוקר", "Morning Edition", "עדכון מיוחד"), or null.
create or replace function public.app_edition_title(p_text text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v_lines text[] := regexp_split_to_array(left(coalesce(p_text, ''), 3000), E'\n');
  s text;
  nxt text;
begin
  for i in 1 .. least(cardinality(v_lines), 20) loop
    s := btrim(v_lines[i]);
    if s !~ '^📻' then
      continue;
    end if;
    if s !~* '(תמצית החדשות|news highlights|essentiel)' then
      return nullif(btrim(public.app_wa_clean(regexp_replace(s, '^📻[[:space:]]*', ''))), '');
    end if;
    for j in i + 1 .. least(cardinality(v_lines), i + 3) loop
      nxt := btrim(v_lines[j]);
      if nxt = '' then
        continue;
      end if;
      if nxt ~* '(מהדורת|המהדורה|edition|édition)' then
        return nullif(btrim((regexp_split_to_array(public.app_wa_clean(nxt), '[,:/]'))[1]), '');
      end if;
      exit;
    end loop;
    return null;
  end loop;
  return null;
end;
$$;

-- Parses one WhatsApp edition into items: sections '📌 *_title:_*' (also '📌 title:', '⬆️ *title:*', '> *title:*'),
-- '• ' bullets with their continuation lines, the good-news section, special updates (plain text).
-- Skips the header, promo blocks between '•   •   •' separators, credits, notices and link-only lines.
-- A bullet that starts with a bold lead-in ending in ':' ("*World Cup 2026:* ...") gets it as headline.
create or replace function public.app_parse_edition(p_text text, p_edition_type text)
returns table (n int, section text, kind text, headline text, body text)
language plpgsql immutable set search_path = public as $$
declare
  v_lines text[] := regexp_split_to_array(replace(coalesce(p_text, ''), E'\r', ''), E'\n');
  v_special boolean := p_edition_type = 'special_update';
  v_active boolean := v_special;
  v_open boolean := false;
  v_section text := null;
  v_kind text := 'news';
  a_section text[] := '{}';
  a_kind text[] := '{}';
  a_raw text[] := '{}';
  s text;
  m text[];
  v_title text;
  v_colon boolean;
  v_n int := 0;
  v_head text;
  v_body text;
  c_sep constant text := '^[[:space:]]*•([[:space:]]+•)+[[:space:]]*$';
  c_emoji constant text := '[ -⯿\U0001F000-\U0001FAFF️‍>]';
  c_deny constant text := '(ערוץ|וואטסאפ|whatsapp|טלגרם|telegram|עוקבים|לשיתוף|הצטרפו|קמפיין|שליחת העדכונים|התנצלות|קוראים יקרים|dear readers|chers lecteurs|facebook|פייסבוק|בחסות|שיווקי|פרסומת|sponsor|publicit|annonce|promo|>>)';
  c_good constant text := '(ונסיים בטוב|positive note|good note|note positive|bonne note)';
  c_url constant text := '^(https?://[^[:space:]]+|[A-Za-z0-9.-]+\.(co\.il|org\.il|com|il)/[^[:space:]]*)$';
begin
  foreach s in array v_lines loop
    if s ~ c_sep then
      if v_special then
        exit when cardinality(a_raw) > 0;
        continue;
      end if;
      v_active := false;
      v_open := false;
      continue;
    end if;
    s := btrim(s);
    continue when s = '';
    if v_special and s ~ '^📻' then
      continue;
    end if;

    if not v_special and s !~ '^(•|✓)' then
      m := regexp_match(s, '^(?:' || c_emoji || '|[[:space:]]){0,8}\*_?([^*]+)\*[[:space:]]*(:?)[[:space:]]*$');
      if m is not null then
        v_colon := m[1] ~ ':[[:space:]_]*$' or m[2] = ':';
        v_title := btrim(regexp_replace(m[1], '[[:space:]_:]+$', ''), ' _');
      else
        m := regexp_match(s, '^[[:space:]]*(?:' || c_emoji || '[[:space:]]*){1,4}([^*:]{2,60}):[[:space:]]*$');
        if m is not null then
          v_colon := true;
          v_title := btrim(m[1]);
        end if;
      end if;
      if m is not null then
        v_active := v_colon and v_title !~* c_deny;
        v_section := v_title;
        v_kind := case when v_title ~* c_good then 'good_news' else 'news' end;
        v_open := false;
        continue;
      end if;
    end if;

    continue when not v_active;
    if s ~ '^•' then
      a_section := a_section || v_section;
      a_kind := a_kind || v_kind;
      a_raw := a_raw || regexp_replace(s, '^•[[:space:]]*', '');
      v_open := true;
      continue;
    end if;
    continue when s ~ c_url;
    if v_open then
      a_raw[cardinality(a_raw)] := a_raw[cardinality(a_raw)] || E'\n' || s;
    else
      a_section := a_section || v_section;
      a_kind := a_kind || v_kind;
      a_raw := a_raw || s;
      v_open := true;
    end if;
  end loop;

  for i in 1 .. cardinality(a_raw) loop
    m := regexp_match(a_raw[i], '^[[:space:]]*\*([^*\n]{2,120})\*[[:space:]]*([:\-–—])?[[:space:]]*(.*)$');
    if m is not null and (m[1] ~ ':[[:space:]]*$' or m[2] is not null) and btrim(m[3]) <> '' then
      v_head := btrim(regexp_replace(public.app_wa_clean(m[1]), '[[:space:]:]+$', ''));
      v_body := public.app_wa_clean(m[3]);
    else
      v_head := '';
      v_body := public.app_wa_clean(a_raw[i]);
    end if;
    continue when v_body = '';
    v_n := v_n + 1;
    n := v_n;
    section := a_section[i];
    kind := a_kind[i];
    headline := v_head;
    body := v_body;
    return next;
  end loop;
end;
$$;

-- Section title -> topic id through app_topics.keywords (case-insensitive substring; lowest sort wins).
create or replace function public.app_topic_for(p_section text) returns text
language sql stable security definer set search_path = public as $$
  select t.id
  from public.app_topics t, unnest(t.keywords) k
  where p_section is not null and t.active and k <> '' and position(lower(k) in lower(p_section)) > 0
  order by t.sort, t.id
  limit 1;
$$;

-- ===========================================================================
-- Editions: de-duplication, mapping, reader tracks
-- ===========================================================================

create or replace function public.app_edition_track(p_edition_type text) returns text
language sql immutable set search_path = public as $$
  select case p_edition_type when 'special_update' then 'special' when 'daily' then 'daily' when 'teens' then 'teens'
    else 'classic' end;
$$;

create or replace function public.app_edition_slot(p_edition_type text, p_time_slot text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_edition_type = 'special_update' then 'special'
    when p_time_slot = 'בוקר' then 'morning'
    when p_time_slot in ('צהריים', 'צוהריים') then 'noon'
    when p_time_slot = 'ערב' then 'evening'
    else 'daily' end;
$$;

-- Contract edition_type: morning|noon|evening|erev_shabbat|motzash|special (daily editions -> evening, or noon).
create or replace function public.app_edition_kind(p_edition_type text, p_time_slot text, p_title text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_edition_type = 'special_update' then 'special'
    when coalesce(p_title, '') ~* '(מוצאי|motz|motsa)' then 'motzash'
    when coalesce(p_title, '') ~* '(ערב שבת|ערב חג|erev|veille)' then 'erev_shabbat'
    when public.app_edition_slot(p_edition_type, p_time_slot) in ('morning', 'noon') then public.app_edition_slot(p_edition_type, p_time_slot)
    else 'evening' end;
$$;

-- One row per published edition of a language in (p_from, p_to]: the engine inserts each edition several
-- times, so identical texts of the same slot and day collapse to the first row (id, created_at). When a slot
-- was re-sent with a different text the newest text wins; special updates keep every distinct text.
create or replace function public.app_editions_window(p_lang text, p_from timestamptz, p_to timestamptz)
returns table (id bigint, published_at timestamptz, edition_date date, track text, slot text,
               edition_type text, time_slot text, main_text text)
language sql stable security definer set search_path = public as $$
  with e as (
    select t.id, t.created_at, t.edition_date, t.edition_type, t.time_slot, t.main_text,
           public.app_edition_track(t.edition_type) as track,
           public.app_edition_slot(t.edition_type, t.time_slot) as slot,
           md5(t.main_text) as h
    from public.tamzit_editions t
    where t.language = public.app_lang_name(p_lang)
      and t.edition_date between (p_from at time zone 'Asia/Jerusalem')::date - 1
                             and (p_to at time zone 'Asia/Jerusalem')::date + 1
  ),
  l as (
    select e.*, first_value(e.h) over (partition by e.edition_type, e.slot, e.edition_date
                                       order by e.created_at desc, e.id desc) as latest_h
    from e
  ),
  g as (
    select l.*, min(l.id) over w as rep_id, min(l.created_at) over w as first_at
    from l
    where l.track = 'special' or l.h = l.latest_h
    window w as (partition by l.edition_type, l.slot, l.edition_date, l.h)
  )
  select g.id, g.first_at, g.edition_date, g.track, g.slot, g.edition_type, g.time_slot, g.main_text
  from g
  where g.id = g.rep_id and g.first_at > p_from and g.first_at <= p_to and g.first_at <= now();
$$;

-- The reader's editions: per day the best available track (youth: teens > classic > daily; one edition a day:
-- daily > classic; otherwise classic > daily), plus every special update of the language.
create or replace function public.app_reader_editions(p_lang text, p_audience text, p_frequency int,
                                                      p_from timestamptz, p_to timestamptz)
returns table (id bigint, published_at timestamptz, edition_date date, track text, slot text,
               edition_type text, time_slot text, main_text text)
language sql stable security definer set search_path = public as $$
  with w as (select * from public.app_editions_window(p_lang, p_from, p_to)),
  prefs as (
    select case when p_audience = 'youth' then array['teens', 'classic', 'daily']
                when public.app_frequency_of(p_frequency) = 1 then array['daily', 'classic']
                else array['classic', 'daily'] end as tracks
  ),
  reg as (
    select w.*, array_position(prefs.tracks, w.track) as rnk
    from w, prefs
    where w.track <> 'special' and w.track = any(prefs.tracks)
  ),
  best as (select reg.edition_date, min(reg.rnk) as rnk from reg group by reg.edition_date)
  select r.id, r.published_at, r.edition_date, r.track, r.slot, r.edition_type, r.time_slot, r.main_text
  from reg r join best b on b.edition_date = r.edition_date and b.rnk = r.rnk
  union all
  select w.id, w.published_at, w.edition_date, w.track, w.slot, w.edition_type, w.time_slot, w.main_text
  from w where w.track = 'special';
$$;

-- ids of all rows of the same edition (the engine's duplicates): audio / ads may hang on any of them.
create or replace function public.app_edition_group(p_id bigint) returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(o.id), array[p_id])
  from public.tamzit_editions e
  join public.tamzit_editions o
    on o.language = e.language and o.edition_type = e.edition_type and o.time_slot = e.time_slot
   and o.edition_date = e.edition_date
   and (e.edition_type <> 'special_update' or md5(o.main_text) = md5(e.main_text))
  where e.id = p_id;
$$;

-- ===========================================================================
-- Items
-- ===========================================================================

-- Version of a structured story: language -> audience (youth falls back to general) -> style -> informative
-- -> any style; title/summary are the base (Hebrew, informative) version.
create or replace function public.app_story_version(p_versions jsonb, p_title text, p_summary text,
                                                    p_lang text, p_aud text, p_style text,
                                                    p_any_language boolean default false)
returns table (headline text, body text, style text, language text)
language plpgsql immutable set search_path = public as $$
declare
  v_langs text[] := array[p_lang] || case when p_any_language then array['he', 'en', 'fr'] else '{}'::text[] end;
  l text;
  a text;
  st text;
  obj jsonb;
  v jsonb;
begin
  foreach l in array v_langs loop
    foreach a in array array[p_aud, 'general'] loop
      obj := p_versions -> l -> a;
      continue when obj is null or jsonb_typeof(obj) <> 'object';
      foreach st in array array[p_style, 'informative'] loop
        v := obj -> st;
        if v is not null and coalesce(v ->> 'body', v ->> 'headline') is not null then
          return query select coalesce(v ->> 'headline', ''), coalesce(v ->> 'body', ''), st, l;
          return;
        end if;
      end loop;
      select e.key, e.value into st, v from jsonb_each(obj) e order by e.key limit 1;
      if v is not null then
        return query select coalesce(v ->> 'headline', ''), coalesce(v ->> 'body', ''), st, l;
        return;
      end if;
    end loop;
  end loop;
  if (p_lang = 'he' or p_any_language) and coalesce(p_title, p_summary) is not null then
    return query select coalesce(p_title, ''), coalesce(p_summary, ''), 'informative'::text, 'he'::text;
  end if;
end;
$$;

create or replace function public.app_story_json(p_story_id bigint, p_lang text, p_aud text, p_style text,
                                                 p_uid uuid, p_any_language boolean default false,
                                                 p_published_at timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', 's' || s.id,
    'topic_id', tp.id,
    'topic_name', coalesce(case p_lang when 'en' then tp.name_en when 'fr' then tp.name_fr else tp.name_he end, s.topic),
    'level', case when coalesce(s.severity, 0) >= 3 then 'critical' when s.severity = 2 then 'important' else 'general' end,
    'kind', coalesce(s.kind, 'news'),
    'community_id', s.community_id,
    'community_name', case p_lang when 'en' then c.name_en when 'fr' then c.name_fr else c.name_he end,
    'headline', v.headline,
    'body', v.body,
    'style', v.style,
    'published_at', coalesce(p_published_at, s.created_at),
    'corrected_at', s.corrected_at,
    'saved', exists (select 1 from public.app_saved_items x where x.profile_id = p_uid and x.item_id = 's' || s.id)
  )
  from public.processed_stories s
  cross join lateral public.app_story_version(s.versions, s.title, s.summary, p_lang, p_aud, p_style, p_any_language) v
  left join lateral (
    select t.* from public.app_topics t
    where t.id = coalesce((select t2.id from public.app_topics t2 where t2.id = s.topic), public.app_topic_for(s.topic))
  ) tp on true
  left join public.app_communities c on c.id = s.community_id
  where s.id = p_story_id and coalesce(s.status, 'published') = 'published';
$$;

-- All items of one edition as FeedItems (+ sort keys): its 'story' elements when it has any, else the parsed text.
create or replace function public.app_edition_items(p_edition_id bigint, p_lang text, p_aud text, p_style text,
                                                    p_uid uuid)
returns table (item_id text, pos int, level text, kind text, topic_id text, community_id text,
               published_at timestamptz, item jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  e public.tamzit_editions;
begin
  select * into e from public.tamzit_editions t where t.id = p_edition_id;
  if not found then
    return;
  end if;
  if exists (select 1 from public.tamzit_edition_elements el
             where el.edition_id = e.id and el.element_type = 'story' and el.story_id is not null) then
    return query
      select j ->> 'id', el.position, j ->> 'level', j ->> 'kind', j ->> 'topic_id', j ->> 'community_id',
             e.created_at, j
      from public.tamzit_edition_elements el
      cross join lateral public.app_story_json(el.story_id, p_lang, p_aud, p_style, p_uid, false, e.created_at) j
      where el.edition_id = e.id and el.element_type = 'story' and j is not null
      order by el.position, el.id;
    return;
  end if;
  return query
    select 'e' || e.id || '-' || p.n, p.n, lv.level, p.kind, tp.topic_id, null::text, e.created_at,
      jsonb_build_object(
        'id', 'e' || e.id || '-' || p.n,
        'topic_id', tp.topic_id,
        'topic_name', p.section,
        'level', lv.level,
        'kind', p.kind,
        'community_id', null,
        'community_name', null,
        'headline', p.headline,
        'body', p.body,
        'style', 'informative',
        'published_at', e.created_at,
        'corrected_at', null,
        'saved', exists (select 1 from public.app_saved_items x
                         where x.profile_id = p_uid and x.item_id = 'e' || e.id || '-' || p.n))
    from public.app_parse_edition(e.main_text, e.edition_type) p
    cross join lateral (select public.app_topic_for(p.section) as topic_id) tp
    cross join lateral (select case when e.edition_type = 'special_update' then 'critical' else 'important' end as level) lv;
end;
$$;

-- One item by its id ('s<story>' or 'e<edition>-<n>'), or null.
create or replace function public.app_item_by_id(p_item_id text, p_lang text, p_aud text, p_style text, p_uid uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ed bigint;
  v_n int;
  j jsonb;
begin
  if p_item_id ~ '^s[0-9]{1,18}$' then
    return public.app_story_json(substr(p_item_id, 2)::bigint, p_lang, p_aud, p_style, p_uid, true);
  end if;
  if p_item_id ~ '^e[0-9]{1,18}-[0-9]{1,6}$' then
    v_ed := (regexp_match(p_item_id, '^e([0-9]+)-'))[1]::bigint;
    v_n := (regexp_match(p_item_id, '-([0-9]+)$'))[1]::int;
    select jsonb_build_object(
        'id', p_item_id, 'topic_id', public.app_topic_for(p.section), 'topic_name', p.section,
        'level', case when e.edition_type = 'special_update' then 'critical' else 'important' end,
        'kind', p.kind, 'community_id', null, 'community_name', null, 'headline', p.headline, 'body', p.body,
        'style', 'informative', 'published_at', e.created_at, 'corrected_at', null,
        'saved', exists (select 1 from public.app_saved_items x where x.profile_id = p_uid and x.item_id = p_item_id))
    into j
    from public.tamzit_editions e
    cross join lateral public.app_parse_edition(e.main_text, e.edition_type) p
    where e.id = v_ed and p.n = v_n;
    return j;
  end if;
  return null;
end;
$$;

-- Ad of an edition group: sponsor = first all-bold line (else a generic label), body without markup/links.
create or replace function public.app_ad_json(p_element_id bigint, p_lang text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  el public.tamzit_edition_elements;
  v_lines text[];
  s text;
  v_sponsor text;
  v_body text[] := '{}';
begin
  select * into el from public.tamzit_edition_elements where id = p_element_id;
  if not found or coalesce(btrim(el.content_text), '') = '' then
    return null;
  end if;
  v_lines := regexp_split_to_array(replace(el.content_text, E'\r', ''), E'\n');
  foreach s in array v_lines loop
    s := btrim(s);
    continue when s = '' or s ~ '^>' or s ~ '^(https?://[^[:space:]]+)$';
    if v_sponsor is null and s ~ '^\*[^*]+\*$' then
      v_sponsor := btrim(public.app_wa_clean(s));
      continue;
    end if;
    v_body := v_body || s;
  end loop;
  return jsonb_build_object(
    'id', 'ad' || el.id,
    'sponsor', left(coalesce(v_sponsor, case p_lang when 'en' then 'Sponsored' when 'fr' then 'Publicité' else 'פרסומת' end), 120),
    'body', public.app_wa_clean(array_to_string(v_body, E'\n')),
    'link_url', (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1],
    'image_url', case when el.media_id ~ '^https?://' then public.app_drive_direct(el.media_id) end
  );
end;
$$;

create or replace function public.app_audio_json(p_element_id bigint, p_title text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', 'au' || el.id,
    'kind', 'edition',
    'title', coalesce(nullif(btrim(el.content_text), ''), p_title, 'תמצית החדשות'),
    'audio_url', public.app_drive_direct(el.media_id),
    'duration_sec', null,
    'published_at', el.created_at)
  from public.tamzit_edition_elements el
  where el.id = p_element_id and el.media_id is not null;
$$;

-- ===========================================================================
-- Premium
-- ===========================================================================

create or replace function public.app_is_premium(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select phone from public.user_preferences where user_id = p_uid and phone is not null)
  select
    exists (
      select 1 from public.app_subscriptions s join me on s.phone = me.phone
      where s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    )
    or exists (
      select 1
      from public.app_family_members fm
      join me on fm.member_phone = me.phone
      join public.user_preferences o on o.user_id = fm.owner_id
      join public.app_subscriptions s on s.phone = o.phone and s.plan = 'family'
      where fm.status in ('joined', 'invited')
        and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    );
$$;

create or replace function public.app_plan_info(p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (select phone from public.user_preferences where user_id = p_uid),
  own as (
    select bool_or(s.plan = 'family') as has_family, bool_or(s.plan = 'premium') as has_premium
    from public.app_subscriptions s join me on s.phone = me.phone
    where s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
  ),
  member as (
    select exists (
      select 1
      from public.app_family_members fm
      join me on fm.member_phone = me.phone
      join public.user_preferences o on o.user_id = fm.owner_id
      join public.app_subscriptions s on s.phone = o.phone and s.plan = 'family'
      where fm.status in ('joined', 'invited')
        and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    ) as is_member
  )
  select jsonb_build_object(
    'plan', case when coalesce(own.has_family, false) then 'family'
                 when coalesce(own.has_premium, false) then 'premium'
                 when member.is_member then 'family'
                 else 'free' end,
    'family_role', case when coalesce(own.has_family, false) then 'owner'
                        when member.is_member then 'member'
                        else null end)
  from own, member;
$$;

create or replace function public.app_require_profile() returns public.user_preferences
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.user_preferences;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  select * into v_prof from public.user_preferences where user_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'no_profile';
  end if;
  return v_prof;
end;
$$;

-- ===========================================================================
-- Feed
-- ===========================================================================

create or replace function public.app_build_feed(
  p_prof public.user_preferences,
  p_lang text,
  p_aud text,
  p_from timestamptz,
  p_to timestamptz,
  p_regular bigint[],        -- regular editions (items, community, good news, audio, ad)
  p_specials bigint[],       -- special updates (special)
  p_filter boolean,          -- profile filter + max_items (personal edition); false = edition as published
  p_title text,
  p_types jsonb
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := p_prof.user_id;
  v_style text := public.app_style_of(p_prof.persona);
  v_topics text[] := coalesce(p_prof.interests, '{}');
  v_min_rank int := public.app_level_rank(public.app_level_of(p_prof.anxiety_level));
  v_communities text[] := coalesce(p_prof.communities, '{}');
  v_premium boolean := public.app_is_premium(v_uid);
  v_max int := public.app_setting_int('max_items', 10);
  v_items jsonb;
  v_special jsonb;
  v_community jsonb;
  v_good jsonb;
  v_ad jsonb;
  v_audio jsonb;
  v_words int;
  v_newest bigint;
  v_prev bigint;
begin
  with eds as (
    select e.id, e.created_at
    from public.tamzit_editions e
    where e.id = any(coalesce(p_regular, '{}') || coalesce(p_specials, '{}'))
  ),
  its as (
    select i.*, (eds.id = any(coalesce(p_specials, '{}'))) as is_special
    from eds cross join lateral public.app_edition_items(eds.id, p_lang, p_aud, v_style, v_uid) i
  ),
  news as (
    select its.item, row_number() over (order by public.app_level_rank(its.level) desc, its.published_at desc,
                                                 its.pos, its.item_id) as rn
    from its
    where not its.is_special and its.kind = 'news'
      and (not p_filter
           or its.level = 'critical'
           or ((its.topic_id is null or cardinality(v_topics) = 0 or its.topic_id = any(v_topics))
               and public.app_level_rank(its.level) >= v_min_rank))
  ),
  sp as (
    select its.item, row_number() over (order by public.app_level_rank(its.level) desc, its.published_at desc,
                                               its.pos) as rn
    from its where its.is_special
  ),
  com as (
    select its.item, its.community_id, its.published_at,
           row_number() over (partition by its.community_id order by its.published_at desc, its.pos) as rn
    from its
    where not its.is_special and its.kind = 'community' and its.community_id = any(v_communities)
  ),
  good as (
    select its.item from its
    where not its.is_special and its.kind = 'good_news'
    order by its.published_at desc, its.pos
    limit 1
  )
  select
    (select coalesce(jsonb_agg(news.item order by news.rn), '[]'::jsonb) from news where not p_filter or news.rn <= v_max),
    (select coalesce(jsonb_agg(sp.item order by sp.rn), '[]'::jsonb) from sp),
    (select coalesce(jsonb_agg(com.item order by array_position(v_communities, com.community_id), com.published_at desc),
                     '[]'::jsonb) from com where com.rn <= 3),
    (select good.item from good)
  into v_items, v_special, v_community, v_good;

  -- good news fallback: the newest good item of the reader's previous editions within 48 hours
  if v_good is null and cardinality(coalesce(p_regular, '{}')) > 0 then
    select i.item into v_good
    from public.app_reader_editions(p_lang, p_aud, p_prof.update_frequency, p_to - interval '48 hours', p_to) r
    cross join lateral public.app_edition_items(r.id, p_lang, p_aud, v_style, v_uid) i
    where r.track <> 'special' and i.kind = 'good_news'
    order by r.published_at desc, i.pos
    limit 1;
  end if;

  select e.id into v_newest from public.tamzit_editions e
  where e.id = any(coalesce(p_regular, '{}')) order by e.created_at desc limit 1;

  -- ad: free readers only; the ad of the newest edition in the feed that has one
  if not v_premium then
    select public.app_ad_json(el.id, p_lang) into v_ad
    from unnest(coalesce(p_regular, '{}')) r(id)
    join public.tamzit_editions e on e.id = r.id
    join public.tamzit_edition_elements el
      on el.edition_id = any(public.app_edition_group(e.id)) and el.element_type in ('ad', 'cta_link')
     and coalesce(btrim(el.content_text), '') <> ''
    order by e.created_at desc, (el.element_type = 'ad') desc, el.created_at desc
    limit 1;
  end if;

  -- audio: of the newest edition in the feed that has one; else the newest audio of the language in 24 hours
  select public.app_audio_json(el.id, 'האזנה · ' || coalesce(public.app_edition_title(e.main_text), 'תמצית החדשות'))
  into v_audio
  from unnest(coalesce(p_regular, '{}')) r(id)
  join public.tamzit_editions e on e.id = r.id
  join public.tamzit_edition_elements el
    on el.edition_id = any(public.app_edition_group(e.id)) and el.element_type = 'audio' and el.media_id is not null
  order by e.created_at desc, el.created_at desc
  limit 1;
  if v_audio is null and p_filter then
    select public.app_audio_json(el.id, 'האזנה · ' || coalesce(public.app_edition_title(e.main_text), 'תמצית החדשות'))
    into v_audio
    from public.tamzit_editions e
    join public.tamzit_edition_elements el on el.edition_id = e.id and el.element_type = 'audio' and el.media_id is not null
    where e.language = public.app_lang_name(p_lang) and e.edition_type <> 'special_update'
      and e.created_at > p_to - interval '24 hours' and e.created_at <= p_to and e.created_at <= now()
    order by e.created_at desc, el.created_at desc
    limit 1;
  end if;

  select coalesce(sum(public.app_word_count(x ->> 'headline') + public.app_word_count(x ->> 'body')), 0)
  into v_words
  from jsonb_array_elements(v_items || v_special || v_community
                            || case when v_good is null then '[]'::jsonb else jsonb_build_array(v_good) end) x;

  return jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'edition_types', coalesce(p_types, '[]'::jsonb),
    'title', p_title,
    'items', v_items,
    'special', v_special,
    'community', v_community,
    'good_news', v_good,
    'ad', v_ad,
    'audio', v_audio,
    'minutes', greatest(1, ceil(v_words / 180.0)::int),
    'is_premium', v_premium
  );
end;
$$;

-- ===========================================================================
-- Client RPCs
-- ===========================================================================

create or replace function public.app_me() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.user_preferences;
  v_plan jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  update public.user_preferences set last_seen_at = now() where user_id = v_uid returning * into v_prof;
  if not found then
    return jsonb_build_object('profile', null, 'is_premium', false, 'plan', 'free', 'family_role', null,
                              'unread_messages', 0);
  end if;
  if v_prof.phone is not null then
    update public.app_family_members set status = 'joined', joined_at = now()
    where member_phone = v_prof.phone and status = 'invited';
  end if;
  v_plan := public.app_plan_info(v_uid);
  return jsonb_build_object(
    'profile', public.app_profile_json(v_prof),
    'is_premium', public.app_is_premium(v_uid),
    'plan', v_plan ->> 'plan',
    'family_role', v_plan -> 'family_role',
    'unread_messages', (select count(*) from public.app_messages m where m.profile_id = v_uid and m.read_at is null)
  );
end;
$$;

create or replace function public.app_personal_edition(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_lang text := coalesce(public.app_lang_code(v_prof.language), 'he');
  v_aud text := case when v_prof.audience = 'youth' then 'youth' else 'general' end;
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := coalesce(p_from, coalesce(p_to, now()) - interval '24 hours');
  v_days int := public.app_setting_int('free_archive_days', 7);
  v_regular bigint[];
  v_specials bigint[];
  v_types jsonb;
  v_title text;
begin
  if v_from < now() - make_interval(days => v_days) - interval '10 minutes'
     and not public.app_is_premium(v_prof.user_id) then
    raise exception using errcode = 'P0001', message = 'archive_locked';
  end if;

  select coalesce(array_agg(r.id order by r.published_at desc) filter (where r.track <> 'special'), '{}'),
         coalesce(array_agg(r.id order by r.published_at desc) filter (where r.track = 'special'), '{}')
  into v_regular, v_specials
  from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, v_from, v_to) r;

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

  return public.app_build_feed(v_prof, v_lang, v_aud, v_from, v_to, v_regular, v_specials, true, v_title, v_types);
end;
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
    false, v_title, jsonb_build_array(public.app_edition_kind(e.edition_type, e.time_slot, v_title)));
end;
$$;

create or replace function public.app_archive(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_lang text := coalesce(public.app_lang_code(v_prof.language), 'he');
  v_aud text := case when v_prof.audience = 'youth' then 'youth' else 'general' end;
  v_premium boolean := public.app_is_premium(v_prof.user_id);
  v_free int := public.app_setting_int('free_archive_days', 7);
  v_days int := least(greatest(coalesce(p_days, 30), 1), 3650);
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id::text,
           'edition_type', public.app_edition_kind(r.edition_type, r.time_slot, x.title),
           'title', x.title,
           'published_at', r.published_at,
           'item_count', case
              when exists (select 1 from public.tamzit_edition_elements el
                           where el.edition_id = r.id and el.element_type = 'story' and el.story_id is not null)
                then (select count(*) from public.tamzit_edition_elements el
                      join public.processed_stories s on s.id = el.story_id
                      where el.edition_id = r.id and el.element_type = 'story'
                        and coalesce(s.kind, 'news') = 'news' and coalesce(s.status, 'published') = 'published')
              else (select count(*) from public.app_parse_edition(r.main_text, r.edition_type) p where p.kind = 'news')
            end::int,
           'has_audio', exists (select 1 from public.tamzit_edition_elements el
                                where el.edition_id = any(public.app_edition_group(r.id))
                                  and el.element_type = 'audio' and el.media_id is not null),
           'read', exists (select 1 from public.app_reads rd
                           where rd.profile_id = v_prof.user_id and rd.edition_key = r.id::text),
           'locked', (not v_premium and r.published_at < now() - make_interval(days => v_free)),
           'track', r.track
         ) order by r.published_at desc), '[]'::jsonb)
  into v_out
  from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, now() - make_interval(days => v_days), now()) r
  cross join lateral (select public.app_edition_title(r.main_text) as title) x;
  return v_out;
end;
$$;

create or replace function public.app_search(p_query text, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_lang text := coalesce(public.app_lang_code(v_prof.language), 'he');
  v_aud text := case when v_prof.audience = 'youth' then 'youth' else 'general' end;
  v_style text := public.app_style_of(v_prof.persona);
  v_q text := btrim(coalesce(p_query, ''));
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_pat text;
  v_out jsonb;
begin
  if not public.app_is_premium(v_prof.user_id) then
    raise exception using errcode = 'P0001', message = 'premium_required';
  end if;
  if length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with eds as (
    select r.id, r.published_at
    from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, now() - interval '3650 days', now()) r
    where r.main_text ilike v_pat
       or exists (select 1 from public.tamzit_edition_elements el
                  join public.processed_stories s on s.id = el.story_id
                  where el.edition_id = r.id and el.element_type = 'story'
                    and (s.versions::text ilike v_pat or s.title ilike v_pat or s.summary ilike v_pat))
    order by r.published_at desc
    limit 40
  ),
  hits as (
    select i.item, eds.published_at, i.pos
    from eds cross join lateral public.app_edition_items(eds.id, v_lang, v_aud, v_style, v_prof.user_id) i
    where i.kind <> 'community' or i.community_id = any(coalesce(v_prof.communities, '{}'))
  )
  select coalesce(jsonb_agg(h.item order by h.published_at desc, h.pos), '[]'::jsonb) into v_out
  from (
    select * from hits
    where hits.item ->> 'headline' ilike v_pat or hits.item ->> 'body' ilike v_pat
    order by hits.published_at desc, hits.pos
    limit v_limit
  ) h;
  return v_out;
end;
$$;

create or replace function public.app_saved() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_lang text := coalesce(public.app_lang_code(v_prof.language), 'he');
  v_aud text := case when v_prof.audience = 'youth' then 'youth' else 'general' end;
  v_out jsonb;
begin
  select coalesce(jsonb_agg(x.j || jsonb_build_object('saved', true) order by x.saved_at desc), '[]'::jsonb) into v_out
  from (
    select coalesce(public.app_item_by_id(s.item_id, v_lang, v_aud, public.app_style_of(v_prof.persona), v_prof.user_id),
                    s.snapshot) as j,
           s.created_at as saved_at
    from public.app_saved_items s
    where s.profile_id = v_prof.user_id
  ) x
  where x.j is not null;
  return v_out;
end;
$$;

create or replace function public.app_toggle_save(p_item_id text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  j jsonb;
begin
  delete from public.app_saved_items where profile_id = v_prof.user_id and item_id = p_item_id;
  if found then
    return false;
  end if;
  j := public.app_item_by_id(p_item_id, coalesce(public.app_lang_code(v_prof.language), 'he'),
                             case when v_prof.audience = 'youth' then 'youth' else 'general' end,
                             public.app_style_of(v_prof.persona), v_prof.user_id);
  if j is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  insert into public.app_saved_items (profile_id, item_id, snapshot)
  values (v_prof.user_id, p_item_id, j || jsonb_build_object('saved', true))
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.app_mark_read(p_edition_key text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
begin
  if p_edition_key is null or length(p_edition_key) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_reads (profile_id, edition_key, read_at) values (v_prof.user_id, p_edition_key, now())
  on conflict (profile_id, edition_key) do update set read_at = excluded.read_at;
end;
$$;

create or replace function public.app_submit_feedback(p_item_id text, p_kind text, p_message text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_id uuid;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if p_kind is null or p_kind not in ('helpful', 'not_helpful', 'error', 'question') then
    raise exception using errcode = 'P0001', message = 'invalid_kind';
  end if;
  if p_item_id is not null
     and public.app_item_by_id(p_item_id, coalesce(public.app_lang_code(v_prof.language), 'he'), 'general',
                               'informative', v_prof.user_id) is null then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if v_msg is not null and length(v_msg) > 4000 then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_feedback (profile_id, item_id, kind, message)
  values (v_prof.user_id, p_item_id, p_kind, v_msg)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_update_profile(p_patch jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  cur jsonb := public.app_profile_json(v_prof);
  v jsonb;
  v_allowed constant text[] := array[
    'full_name', 'birth_year', 'city', 'language', 'audience', 'frequency', 'slot_times', 'level_filter',
    'style', 'topics', 'communities', 'special_push', 'edition_push', 'headline_in_push', 'text_scale',
    'theme', 'shabbat_city_id', 'onboarded'];
  v_patch jsonb;
  v_freq int;
  v_slots text[];
  v_err text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
  from jsonb_each(p_patch) where key = any(v_allowed);
  v := cur || v_patch;

  begin
    v_freq := (v ->> 'frequency')::int;
    v_slots := array(select jsonb_array_elements_text(v -> 'slot_times'));
    if v_patch ? 'frequency' and not v_patch ? 'slot_times' and cardinality(v_slots) is distinct from v_freq then
      v_slots := public.app_default_slots(v_freq);
    end if;
    v_err := case
      when coalesce(btrim(v ->> 'full_name'), '') = '' or length(v ->> 'full_name') > 120 then 'full_name'
      when coalesce(v ->> 'language', '') not in ('he', 'en', 'fr') then 'language'
      when coalesce(v ->> 'audience', '') not in ('general', 'youth') then 'audience'
      when v_freq is null or v_freq not between 1 and 3 then 'frequency'
      when cardinality(v_slots) <> v_freq
        or array_to_string(v_slots, ',') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](,([01][0-9]|2[0-3]):[0-5][0-9])*$' then 'slot_times'
      when coalesce(v ->> 'level_filter', '') not in ('critical', 'important', 'general') then 'level_filter'
      when coalesce(v ->> 'style', '') not in ('calm', 'human', 'informative', 'light') then 'style'
      when coalesce(v ->> 'theme', '') not in ('system', 'light', 'dark') then 'theme'
      when coalesce((v ->> 'text_scale')::real, 0) not between 0.5 and 3 then 'text_scale'
      when jsonb_typeof(v -> 'special_push') <> 'boolean' or jsonb_typeof(v -> 'edition_push') <> 'boolean'
        or jsonb_typeof(v -> 'headline_in_push') <> 'boolean' or jsonb_typeof(v -> 'onboarded') <> 'boolean' then 'boolean'
      when jsonb_typeof(v -> 'birth_year') = 'number' and (v ->> 'birth_year')::int not between 1900 and 2100 then 'birth_year'
      when jsonb_typeof(v -> 'topics') <> 'array' then 'topics'
      when jsonb_typeof(v -> 'communities') <> 'array' then 'communities'
      when not exists (select 1 from public.app_cities c where c.id = v ->> 'shabbat_city_id') then 'shabbat_city_id'
      else null end;
  exception
    when data_exception then
      v_err := coalesce(v_err, 'type');
  end;
  if v_err is not null then
    raise exception using errcode = 'P0001', message = 'invalid_value', detail = v_err;
  end if;

  begin
    update public.user_preferences set
      name = btrim(v ->> 'full_name'),
      birth_year = (v ->> 'birth_year')::int,
      city = v ->> 'city',
      language = v ->> 'language',
      audience = v ->> 'audience',
      update_frequency = v_freq,
      slot_times = v_slots,
      anxiety_level = public.app_anxiety_of(v ->> 'level_filter'),
      persona = public.app_persona_of(v ->> 'style'),
      interests = array(select jsonb_array_elements_text(v -> 'topics')),
      communities = array(select jsonb_array_elements_text(v -> 'communities')),
      special_push = (v ->> 'special_push')::boolean,
      edition_push = (v ->> 'edition_push')::boolean,
      headline_in_push = (v ->> 'headline_in_push')::boolean,
      text_scale = (v ->> 'text_scale')::real,
      theme = v ->> 'theme',
      shabbat_city_id = v ->> 'shabbat_city_id',
      onboarded = (v ->> 'onboarded')::boolean,
      updated_at = now()
    where user_id = v_prof.user_id
    returning * into v_prof;
  exception
    when data_exception or integrity_constraint_violation then
      raise exception using errcode = 'P0001', message = 'invalid_value', detail = sqlerrm;
  end;
  return public.app_profile_json(v_prof);
end;
$$;

create or replace function public.app_family_invite(p_phone text, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_phone text := public.app_normalize_phone(p_phone);
  v_row public.app_family_members;
begin
  if coalesce(public.app_plan_info(v_prof.user_id) ->> 'family_role', '') <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not_family_owner';
  end if;
  if v_phone is null or v_phone = v_prof.phone then
    raise exception using errcode = 'P0001', message = 'invalid_phone';
  end if;
  insert into public.app_family_members as m (owner_id, member_phone, member_name, status, invited_at)
  values (v_prof.user_id, v_phone, nullif(btrim(coalesce(p_name, '')), ''), 'invited', now())
  on conflict (owner_id, member_phone) do update set
    member_name = coalesce(excluded.member_name, m.member_name),
    status = case when m.status = 'removed' then 'invited' else m.status end,
    invited_at = case when m.status = 'removed' then now() else m.invited_at end,
    joined_at = case when m.status = 'removed' then null else m.joined_at end
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.app_family_remove(p_phone text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_phone text := public.app_normalize_phone(p_phone);
begin
  if coalesce(public.app_plan_info(v_prof.user_id) ->> 'family_role', '') <> 'owner'
     and not exists (select 1 from public.app_family_members where owner_id = v_prof.user_id) then
    raise exception using errcode = 'P0001', message = 'not_family_owner';
  end if;
  update public.app_family_members set status = 'removed'
  where owner_id = v_prof.user_id and member_phone = coalesce(v_phone, p_phone);
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
end;
$$;

create or replace function public.app_register_device(p_token text, p_platform text) returns void
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
  insert into public.app_devices (profile_id, push_token, platform)
  values (v_prof.user_id, btrim(p_token), p_platform)
  on conflict (push_token) do update set
    profile_id = excluded.profile_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

create or replace function public.app_record_donation(p_amount numeric, p_frequency text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;
  if p_frequency is null or p_frequency not in ('once', 'monthly') then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_donations (profile_id, amount, frequency) values (v_prof.user_id, p_amount, p_frequency)
  returning id into v_id;
  return v_id;
end;
$$;

-- ===========================================================================
-- Push: special updates
-- ===========================================================================

-- Payload for app-push-special (service role): language, first item text, edition time.
create or replace function public.app_push_payload(p_edition_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'edition_id', e.id,
    'language', public.app_lang_code(e.language),
    'edition_type', e.edition_type,
    'created_at', e.created_at,
    'title', public.app_edition_title(e.main_text),
    'headline', (select coalesce(nullif(i.item ->> 'headline', ''), left(i.item ->> 'body', 140))
                 from public.app_edition_items(e.id, public.app_lang_code(e.language), 'general', 'informative', null) i
                 order by i.pos limit 1))
  from public.tamzit_editions e where e.id = p_edition_id;
$$;

-- AFTER INSERT on tamzit_editions: one push per distinct special update (the engine inserts each edition several
-- times). Never raises, so the engine's insert can never fail because of the app.
create or replace function public.app_tamzit_editions_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
  v_key text;
begin
  begin
    if new.edition_type is distinct from 'special_update' or new.created_at < now() - interval '2 hours' then
      return new;
    end if;
    v_key := 'special:' || coalesce(new.language, '') || ':' || md5(coalesce(new.main_text, ''));
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
      url := rtrim(v_url, '/') || '/app-push-special',
      body := jsonb_build_object('edition_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-app-secret', coalesce(v_secret, '')),
      timeout_milliseconds := 10000);
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
-- Engine: write an edition with structured stories
-- ===========================================================================

-- p_edition = { id?, language ('he'|'hebrew'…), edition_type ('classic'|'daily'|'teens'|'special_update'),
--               time_slot ('בוקר'|'צהריים'|'ערב'|'יומי'|'עדכון מיוחד'), edition_date?, main_text?,
--               stories: [ { id?, title, summary, severity, topic, kind?, community_id?, status?, corrected_at?,
--                            versions? } ] }      -- array order = position
-- Creates or updates the tamzit_editions row (id given = update), upserts processed_stories (by id) and replaces
-- the edition's 'story' elements. main_text is generated from the stories when not given. Returns
-- { edition_id, story_ids }.
create or replace function public.app_engine_upsert_edition(p_edition jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_lang text := public.app_lang_name(coalesce(p_edition ->> 'language', 'he'));
  v_type text := coalesce(p_edition ->> 'edition_type', 'classic');
  v_slot text := coalesce(p_edition ->> 'time_slot', case when p_edition ->> 'edition_type' = 'special_update' then 'עדכון מיוחד' else 'ערב' end);
  v_ed bigint := (p_edition ->> 'id')::bigint;
  v_text text := p_edition ->> 'main_text';
  v_story jsonb;
  v_sid bigint;
  v_ids bigint[] := '{}';
  v_pos int := 0;
  v_gen text := '';
  v_sec text;
  v_last_sec text := null;
begin
  if v_lang is null then
    raise exception using errcode = 'P0001', message = 'invalid_value', detail = 'language';
  end if;
  if v_type not in ('classic', 'daily', 'teens', 'special_update') then
    raise exception using errcode = 'P0001', message = 'invalid_value', detail = 'edition_type';
  end if;

  if coalesce(v_text, '') = '' then
    v_gen := case when v_type = 'special_update' then E'📻 *עדכון מיוחד*\n\n' else E'📻 *תמצית החדשות*\n\n•   •   •\n' end;
    for v_story in select * from jsonb_array_elements(coalesce(p_edition -> 'stories', '[]'::jsonb)) loop
      if v_type <> 'special_update' then
        v_sec := case when v_story ->> 'kind' = 'good_news' then 'ונסיים בטוב'
                      else coalesce((select t.name_he from public.app_topics t where t.id = v_story ->> 'topic'),
                                    v_story ->> 'topic', 'חדשות') end;
        if v_sec is distinct from v_last_sec then
          v_gen := v_gen || E'\n📌 *_' || v_sec || E':_*\n';
          v_last_sec := v_sec;
        end if;
        v_gen := v_gen || '• ';
      end if;
      v_gen := v_gen || coalesce(v_story ->> 'summary', v_story ->> 'title', '') || E'\n';
    end loop;
    v_text := v_gen;
  end if;

  if v_ed is null then
    insert into public.tamzit_editions (edition_date, main_text, language, edition_type, time_slot)
    values (coalesce((p_edition ->> 'edition_date')::date, (now() at time zone 'Asia/Jerusalem')::date),
            v_text, v_lang, v_type, v_slot)
    returning id into v_ed;
  else
    update public.tamzit_editions set
      main_text = v_text, language = v_lang, edition_type = v_type, time_slot = v_slot,
      edition_date = coalesce((p_edition ->> 'edition_date')::date, edition_date)
    where id = v_ed;
    if not found then
      raise exception using errcode = 'P0001', message = 'not_found', detail = 'edition id';
    end if;
  end if;

  delete from public.tamzit_edition_elements where edition_id = v_ed and element_type = 'story';

  for v_story in select * from jsonb_array_elements(coalesce(p_edition -> 'stories', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    v_sid := (v_story ->> 'id')::bigint;
    if v_sid is not null and exists (select 1 from public.processed_stories where id = v_sid) then
      update public.processed_stories set
        title = v_story ->> 'title', summary = v_story ->> 'summary', severity = (v_story ->> 'severity')::int,
        topic = v_story ->> 'topic', kind = coalesce(v_story ->> 'kind', 'news'),
        community_id = v_story ->> 'community_id', status = coalesce(v_story ->> 'status', 'published'),
        corrected_at = (v_story ->> 'corrected_at')::timestamptz,
        versions = coalesce(v_story -> 'versions', versions, '{}'::jsonb)
      where id = v_sid;
    else
      insert into public.processed_stories (title, summary, severity, topic, kind, community_id, status, corrected_at, versions)
      values (v_story ->> 'title', v_story ->> 'summary', (v_story ->> 'severity')::int, v_story ->> 'topic',
              coalesce(v_story ->> 'kind', 'news'), v_story ->> 'community_id',
              coalesce(v_story ->> 'status', 'published'), (v_story ->> 'corrected_at')::timestamptz,
              coalesce(v_story -> 'versions', '{}'::jsonb))
      returning id into v_sid;
    end if;
    insert into public.tamzit_edition_elements (edition_id, element_type, story_id, position)
    values (v_ed, 'story', v_sid, v_pos);
    v_ids := v_ids || v_sid;
  end loop;

  return jsonb_build_object('edition_id', v_ed, 'story_ids', to_jsonb(v_ids));
end;
$$;

-- ===========================================================================
-- Privileges
-- ===========================================================================

do $$
declare
  f record;
  client_rpcs constant text[] := array['app_me', 'app_personal_edition', 'app_edition_view', 'app_archive',
    'app_search', 'app_saved', 'app_toggle_save', 'app_mark_read', 'app_submit_feedback', 'app_update_profile',
    'app_family_invite', 'app_family_remove', 'app_register_device', 'app_record_donation', 'app_my_phone'];
  server_rpcs constant text[] := array['app_engine_upsert_edition', 'app_push_payload', 'app_is_premium',
    'app_plan_info', 'app_setting_text', 'app_setting_int', 'app_normalize_phone', 'app_parse_edition',
    'app_edition_title', 'app_editions_window'];
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
