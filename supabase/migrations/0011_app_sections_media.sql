-- Tamzit app: two heading levels, the ad with its image and link, and playable audio.
--
-- (a) app_parse_edition returns the item's section (level 1) and subsection (level 2). The security fronts sit
--     under one "ביטחון" / "Security" / "Sécurité" section: "📌 ביטחון - החזית הדרומית" (engine flashes),
--     "📌 החזית הדרומית" (sent editions), "Southern Front", "Le front sud", "Yehuda and Shomron". FeedItem gets
--     `section` and `subsection`; the feed orders news by section, then subsection, then edition and position.
-- (b) Audio: the engine's public mp3 in the news-audio bucket ("<date>news.mp3" Hebrew, "<date>news-french.mp3"
--     French) made minutes before the edition is sent; else the Drive audio attached to the edition, once
--     app-media-sync has copied it into the public app-media bucket (Drive files must be shared "anyone with the
--     link"). Only playable links are returned; a Drive link never reaches the app.
-- (c) Ads (also donation campaigns) are matched to an edition by the language of their text and the send time:
--     the engine sometimes links an element to the row of another language that was sent at the same second.
--     The ad JSON gets `label` ("המהדורה בחסות"), `sponsor` (nullable), the full body, the link, and an image:
--     the attached image (copied from Drive) or the link's preview image (og:image, like WhatsApp).
-- (d) app_media / app_link_previews: work tables of the app-media-sync edge function, which a trigger on new
--     edition elements and a pg_cron job (every 5 minutes) call with the push_webhook_secret header.
-- Idempotent.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ===========================================================================
-- Work tables (server only: RLS on, no policies)
-- ===========================================================================

create table if not exists public.app_media (
  drive_id text primary key,
  source_url text not null,
  kind text,                                   -- audio | image | video | other (from the file's type)
  status text not null default 'pending',      -- pending | ok | private | failed | expired
  storage_path text,
  public_url text,
  mime text,
  bytes bigint,
  file_name text,
  error text,
  tries int not null default 0,
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Also copies of the engine's news-audio mp3s (key 'na:<storage object id>'), which that bucket keeps only about a
-- day: src_created_at / src_size are the original object's, so editions still find their audio after it is gone.
alter table public.app_media add column if not exists src_created_at timestamptz;
alter table public.app_media add column if not exists src_size bigint;
create index if not exists app_media_todo_idx on public.app_media (next_try_at) where status <> 'ok';
alter table public.app_media enable row level security;

create table if not exists public.app_link_previews (
  url text primary key,
  status text not null default 'pending',      -- pending | ok | none | failed
  image_url text,                              -- public copy in app-media/previews
  title text,
  error text,
  tries int not null default 0,
  next_try_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists app_link_previews_todo_idx on public.app_link_previews (next_try_at) where status <> 'ok';
alter table public.app_link_previews enable row level security;

-- ===========================================================================
-- Helpers
-- ===========================================================================

-- Google Drive file id of a Drive link, or null.
create or replace function public.app_drive_id(p text) returns text
language sql immutable set search_path = public as $$
  select coalesce(
    (regexp_match(p, 'drive\.google\.com/file/d/([A-Za-z0-9_-]+)'))[1],
    case when p ~ '(drive|docs|drive\.usercontent)\.google\.com/' then (regexp_match(p, '[?&]id=([A-Za-z0-9_-]+)'))[1] end);
$$;

-- Percent-encoding for a storage object name (keeps '/').
create or replace function public.app_url_encode(p text) returns text
language plpgsql immutable set search_path = public as $$
declare
  b bytea := convert_to(coalesce(p, ''), 'UTF8');
  out text := '';
  c int;
begin
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if (c between 48 and 57) or (c between 65 and 90) or (c between 97 and 122) or c in (45, 46, 95, 126, 47) then
      out := out || chr(c);
    else
      out := out || '%' || upper(lpad(to_hex(c), 2, '0'));
    end if;
  end loop;
  return out;
end;
$$;

-- https://<ref>.supabase.co/storage/v1/object/public (from the functions_base_url setting).
create or replace function public.app_storage_public_base() returns text
language sql stable security definer set search_path = public as $$
  select regexp_replace(rtrim(public.app_setting_text('functions_base_url'), '/'), '/functions/v1$', '')
         || '/storage/v1/object/public';
$$;

-- Playable/public URL of an element's media: the app-media copy of a Drive file (null until copied, or when its
-- type is not p_kind: 'audio' also accepts video containers), or any other https URL as is.
create or replace function public.app_media_url(p_media_id text, p_kind text default null) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_media_id is null then null
    when public.app_drive_id(p_media_id) is not null then (
      select m.public_url from public.app_media m
      where m.drive_id = public.app_drive_id(p_media_id) and m.status = 'ok'
        and (p_kind is null or m.kind = p_kind or (p_kind = 'audio' and m.kind = 'video')))
    when p_media_id ~ '^https://' then p_media_id
  end;
$$;

-- Language of a text by its letters: 'he' | 'fr' | 'en' | null.
create or replace function public.app_text_lang(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(p, '') !~ '[A-Za-zא-ת]' then null
    when length(regexp_replace(p, '[^א-ת]', '', 'g'))
         >= greatest(3, length(regexp_replace(regexp_replace(p, 'https?://[^[:space:]]+', '', 'g'), '[^A-Za-z]', '', 'g')) / 3)
      then 'he'
    when p ~* '[àâçéèêëîïôûùœ]' or p ~* '\m(le|la|les|des|une|est|pour|avec|dans|nous)\M' then 'fr'
    else 'en' end;
$$;

-- Level-1 / level-2 headings of an edition heading: {section, subsection}.
create or replace function public.app_section_split(p_title text) returns text[]
language plpgsql immutable set search_path = public as $$
declare
  t text := btrim(coalesce(p_title, ''));
  m text[];
begin
  if t = '' then
    return array[null, null]::text[];
  end if;
  -- "ביטחון - החזית הדרומית" (the engine's flashes)
  m := regexp_match(t, '^([^-–—]{2,24}?)[[:space:]]+[-–—][[:space:]]+(.{2,60})$');
  if m is not null then
    return array[btrim(m[1]), btrim(m[2])];
  end if;
  if t ~ '[א-ת]' then
    if t ~ '^(ביטחון|בטחון)$' then
      return array['ביטחון', null];
    end if;
    if t ~ '^ה?(חזית|זירה)' or t ~ '(איו"ש|יהודה ושומרון)' then
      return array['ביטחון', t];
    end if;
    return array[t, null];
  end if;
  if t ~* '^s[ée]curit[ée]$' then
    return array['Sécurité', null];
  end if;
  if t ~* '^(le front|la fronti[èe]re|au nord|au sud|yehouda|jud[ée]e)' then
    return array['Sécurité', t];
  end if;
  if t ~* '^security$' then
    return array['Security', null];
  end if;
  if t ~* '(front$|^yehuda|shomron|judea|samaria)' then
    return array['Security', t];
  end if;
  return array[t, null];
end;
$$;

-- ===========================================================================
-- Parsing: sections and subsections
-- ===========================================================================

drop function if exists public.app_parse_edition(text, text);

-- Parses one WhatsApp edition into items: sections '📌 *_title:_*' (also '📌 title:', '⬆️ *title:*', '> *title:*'),
-- '• ' bullets with their continuation lines, the good-news section, special updates (plain text).
-- Skips the header, promo blocks between '•   •   •' separators, credits, notices and link-only lines.
-- A bullet that starts with a bold lead-in ending in ':' ("*World Cup 2026:* ...") gets it as headline.
-- section/subsection: the heading split into two levels (app_section_split).
create or replace function public.app_parse_edition(p_text text, p_edition_type text)
returns table (n int, section text, subsection text, kind text, headline text, body text)
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
  v_split text[];
  c_sep constant text := '^[[:space:]]*•([[:space:]]+•)+[[:space:]]*$';
  c_emoji constant text := '[\u2190-\u2BFF\U0001F000-\U0001FAFF\uFE0F\u200D>]';  -- symbols and emoji, not letters
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
        m := regexp_match(s, '^[[:space:]]*(?:' || c_emoji || '[[:space:]]*){1,4}([^*:]{2,60}):?[[:space:]]*$');
        if m is not null and (s ~ ':[[:space:]]*$' or s ~ '^[[:space:]]*📌') then
          v_colon := true;
          v_title := btrim(m[1]);
        else
          m := null;
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
    v_split := public.app_section_split(public.app_wa_clean(a_section[i]));
    v_n := v_n + 1;
    n := v_n;
    section := v_split[1];
    subsection := v_split[2];
    kind := a_kind[i];
    headline := v_head;
    body := v_body;
    return next;
  end loop;
end;
$$;

-- ===========================================================================
-- Items: section / subsection in the item JSON
-- ===========================================================================

create or replace function public.app_story_json(p_story_id bigint, p_lang text, p_aud text, p_style text,
                                                 p_uid uuid, p_any_language boolean default false,
                                                 p_published_at timestamptz default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', 's' || s.id,
    'topic_id', tp.id,
    'topic_name', coalesce(case p_lang when 'en' then tp.name_en when 'fr' then tp.name_fr else tp.name_he end, s.topic),
    'section', coalesce(case p_lang when 'en' then tp.name_en when 'fr' then tp.name_fr else tp.name_he end, s.topic),
    'subsection', null,
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

-- One parsed item as a FeedItem.
create or replace function public.app_parsed_item_json(p_edition public.tamzit_editions, p_n int, p_section text,
                                                       p_subsection text, p_kind text, p_headline text, p_body text,
                                                       p_uid uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', 'e' || p_edition.id || '-' || p_n,
    'topic_id', public.app_topic_for(concat_ws(' / ', p_section, p_subsection)),
    'topic_name', coalesce(p_subsection, p_section),
    'section', p_section,
    'subsection', p_subsection,
    'level', case when p_edition.edition_type = 'special_update' then 'critical' else 'important' end,
    'kind', p_kind,
    'community_id', null,
    'community_name', null,
    'headline', p_headline,
    'body', p_body,
    'style', 'informative',
    'published_at', p_edition.created_at,
    'corrected_at', null,
    'saved', exists (select 1 from public.app_saved_items x
                     where x.profile_id = p_uid and x.item_id = 'e' || p_edition.id || '-' || p_n));
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
    select j ->> 'id', p.n, j ->> 'level', p.kind, j ->> 'topic_id', null::text, e.created_at, j
    from public.app_parse_edition(e.main_text, e.edition_type) p
    cross join lateral public.app_parsed_item_json(e, p.n, p.section, p.subsection, p.kind, p.headline, p.body, p_uid) j;
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
    select public.app_parsed_item_json(e, p.n, p.section, p.subsection, p.kind, p.headline, p.body, p_uid)
    into j
    from public.tamzit_editions e
    cross join lateral public.app_parse_edition(e.main_text, e.edition_type) p
    where e.id = v_ed and p.n = v_n;
    return j;
  end if;
  return null;
end;
$$;

-- ===========================================================================
-- Elements of an edition: audio and ads, matched by language and send time
-- ===========================================================================

-- Language of the edition whose sending started last at (or just before) p_at. The engine adds an edition's audio
-- and ad seconds after it starts sending it, but sometimes links them to a row of another language sent in the
-- same second; this is the second opinion.
create or replace function public.app_element_sent_lang(p_at timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select g.language
  from (
    select e.language, min(e.created_at) as first_at
    from public.tamzit_editions e
    where e.edition_date between (p_at at time zone 'Asia/Jerusalem')::date - 1 and (p_at at time zone 'Asia/Jerusalem')::date
    group by e.language, e.edition_type, e.time_slot, e.edition_date
  ) g
  where g.first_at <= p_at + interval '500 milliseconds' and g.first_at > p_at - interval '30 minutes'
  order by g.first_at desc
  limit 1;
$$;

-- First and last send of an edition (all rows of its group).
create or replace function public.app_edition_span(p_edition_id bigint, out first_at timestamptz, out last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select min(o.created_at), max(o.created_at)
  from public.tamzit_editions o where o.id = any(public.app_edition_group(p_edition_id));
$$;

-- The spoken edition as an Audio JSON, or null when there is no playable one. p_title: the player title.
create or replace function public.app_edition_audio(p_edition_id bigint, p_title text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e public.tamzit_editions;
  v_lang text;
  v_span record;
  v_chars int;
  v_rate numeric;
  v_pat text;
  o record;
  v_el record;
  v_url text;
begin
  select * into e from public.tamzit_editions t where t.id = p_edition_id;
  if not found or e.edition_type = 'special_update' then
    return null;
  end if;
  v_lang := public.app_lang_code(e.language);
  select * into v_span from public.app_edition_span(e.id);

  -- 1. The engine's mp3 in the public news-audio bucket; when several fit, the one whose length suits the text.
  v_pat := case v_lang when 'he' then '\)news\.mp3$' when 'fr' then 'news-french\.mp3$' when 'en' then 'news-english\.mp3$' end;
  v_rate := case v_lang when 'he' then 9.3 else 13.5 end;
  if v_pat is not null then
    select coalesce(sum(length(p.body) + length(coalesce(p.headline, ''))), 0) into v_chars
    from public.app_parse_edition(e.main_text, e.edition_type) p;
    -- the bucket's objects, and our copies of them (the bucket keeps them only about a day); the copy wins
    select c.key, c.url, c.created_at into o
    from (
      select distinct on (x.key) x.key, x.url, x.created_at, x.size
      from (
        select m.drive_id as key, m.public_url as url, m.src_created_at as created_at, m.src_size as size, 0 as pref
        from public.app_media m
        where m.drive_id like 'na:%' and m.status = 'ok' and m.file_name ~ v_pat
          and m.src_created_at between v_span.first_at - interval '45 minutes' and v_span.first_at + interval '2 minutes'
        union all
        select 'na:' || so.id, public.app_storage_public_base() || '/news-audio/' || public.app_url_encode(so.name),
               so.created_at, (so.metadata ->> 'size')::bigint, 1
        from storage.objects so
        where so.bucket_id = 'news-audio' and so.name ~ v_pat
          and so.created_at between v_span.first_at - interval '45 minutes' and v_span.first_at + interval '2 minutes'
      ) x
      order by x.key, x.pref
    ) c
    order by case when v_chars > 0 then
               abs(ln(greatest(coalesce(c.size, 0)::numeric * 8 / 142000, 1) / greatest(v_chars / v_rate, 1)))
             else 0 end,
             c.created_at desc
    limit 1;
    if o.key is not null then
      return jsonb_build_object(
        'id', replace(replace(o.key, 'na:', 'na'), '-', ''),
        'kind', 'edition',
        'title', coalesce(p_title, public.app_edition_title(e.main_text), 'תמצית החדשות'),
        'audio_url', o.url,
        'duration_sec', null,
        'published_at', o.created_at);
    end if;
  end if;

  -- 2. The audio element the engine attached (Drive), copied to app-media by app-media-sync.
  select el.id, el.media_id, el.created_at into v_el
  from public.tamzit_edition_elements el
  join public.tamzit_editions le on le.id = el.edition_id
  where el.element_type = 'audio' and el.media_id is not null
    and el.created_at between v_span.first_at - interval '5 seconds' and v_span.last_at + interval '20 minutes'
    and (le.language = e.language or public.app_element_sent_lang(el.created_at) = e.language)
  order by (le.language = e.language and public.app_element_sent_lang(el.created_at) = e.language) desc,
           (public.app_element_sent_lang(el.created_at) = e.language) desc,
           el.created_at
  limit 1;
  if v_el.id is null then
    return null;
  end if;
  v_url := public.app_media_url(v_el.media_id, 'audio');
  if v_url is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', 'au' || v_el.id,
    'kind', 'edition',
    'title', coalesce(p_title, public.app_edition_title(e.main_text), 'תמצית החדשות'),
    'audio_url', v_url,
    'duration_sec', null,
    'published_at', v_el.created_at);
end;
$$;

-- The ad (or donation campaign) of an edition in the reader's language: element id, or null.
create or replace function public.app_edition_ad(p_edition_id bigint, p_lang text) returns bigint
language sql stable security definer set search_path = public as $$
  with g as (select public.app_edition_group(p_edition_id) as ids),
  s as (select * from public.app_edition_span(p_edition_id))
  select el.id
  from public.tamzit_edition_elements el, g, s
  where el.element_type in ('ad', 'donation_campaign', 'cta_link')
    and coalesce(btrim(el.content_text), '') <> ''
    and (el.edition_id = any(g.ids)
         or el.created_at between s.first_at - interval '2 minutes' and s.last_at + interval '20 minutes')
    and public.app_text_lang(el.content_text) = p_lang
  order by (el.edition_id = any(g.ids)) desc, (el.element_type = 'ad') desc, el.created_at desc
  limit 1;
$$;

-- Ad JSON: label from its "> ..." line, sponsor = a leading all-bold line, full body, first link, image.
create or replace function public.app_ad_json(p_element_id bigint, p_lang text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  el public.tamzit_edition_elements;
  v_lines text[];
  s text;
  v_label text;
  v_sponsor text;
  v_body text[] := '{}';
  v_link text;
  v_image text;
begin
  select * into el from public.tamzit_edition_elements where id = p_element_id;
  if not found or coalesce(btrim(el.content_text), '') = '' then
    return null;
  end if;
  v_lines := regexp_split_to_array(replace(el.content_text, E'\r', ''), E'\n');
  foreach s in array v_lines loop
    s := btrim(s);
    continue when s = '';
    if s ~ '^>' then
      v_label := coalesce(v_label, nullif(btrim(public.app_wa_clean(regexp_replace(s, '^>+[[:space:]]*|[[:space:]:]+$', '', 'g'))), ''));
      continue;
    end if;
    continue when s ~ '^(https?://[^[:space:]]+)$';
    if v_sponsor is null and cardinality(v_body) = 0 and s ~ '^\*[^*]+\*$' then
      v_sponsor := nullif(btrim(public.app_wa_clean(s)), '');
      continue;
    end if;
    v_body := v_body || s;
  end loop;
  v_link := (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1];
  v_image := public.app_media_url(el.media_id, 'image');
  if v_image is null and v_link is not null then
    select p.image_url into v_image from public.app_link_previews p where p.url = v_link and p.status = 'ok';
  end if;
  return jsonb_build_object(
    'id', 'ad' || el.id,
    'label', left(coalesce(v_label, case p_lang when 'en' then 'Sponsored' when 'fr' then 'Publicité' else 'פרסומת' end), 80),
    'sponsor', left(v_sponsor, 120),
    'body', public.app_wa_clean(array_to_string(v_body, E'\n')),
    'link_url', v_link,
    'image_url', v_image
  );
end;
$$;

-- Kept for callers of the first version: a Drive audio element as Audio JSON (null until it is playable).
create or replace function public.app_audio_json(p_element_id bigint, p_title text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', 'au' || el.id,
    'kind', 'edition',
    'title', coalesce(nullif(btrim(el.content_text), ''), p_title, 'תמצית החדשות'),
    'audio_url', public.app_media_url(el.media_id, 'audio'),
    'duration_sec', null,
    'published_at', el.created_at)
  from public.tamzit_edition_elements el
  where el.id = p_element_id and public.app_media_url(el.media_id, 'audio') is not null;
$$;

-- ===========================================================================
-- Feed: news grouped by section and subsection; ad and audio by edition
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
  r record;
begin
  with eds as (
    select e.id, e.created_at, dense_rank() over (order by e.created_at desc, e.id desc) as ed_rank
    from public.tamzit_editions e
    where e.id = any(coalesce(p_regular, '{}') || coalesce(p_specials, '{}'))
  ),
  its as (
    select i.*, eds.ed_rank, (eds.id = any(coalesce(p_specials, '{}'))) as is_special
    from eds cross join lateral public.app_edition_items(eds.id, p_lang, p_aud, v_style, v_uid) i
  ),
  news as (
    select its.item, its.ed_rank, its.pos, its.level,
           coalesce(its.item ->> 'section', '') as sec, coalesce(its.item ->> 'subsection', '') as sub,
           row_number() over (order by public.app_level_rank(its.level) desc, its.published_at desc,
                                       its.pos, its.item_id) as rn
    from its
    where not its.is_special and its.kind = 'news'
      and (not p_filter
           or its.level = 'critical'
           or ((its.topic_id is null or cardinality(v_topics) = 0 or its.topic_id = any(v_topics))
               and public.app_level_rank(its.level) >= v_min_rank))
  ),
  picked as (
    -- sections in the order they first appear (newest edition first; weather last), subsections likewise
    select news.*, (news.item ->> 'topic_id') is not distinct from 'weather' as is_weather,
           min(array[news.ed_rank, news.pos]) over (partition by news.sec) as sec_key,
           min(array[news.ed_rank, news.pos]) over (partition by news.sec, news.sub) as sub_key
    from news
    where not p_filter or news.rn <= v_max
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
    (select coalesce(jsonb_agg(picked.item order by picked.is_weather, picked.sec_key, picked.sub_key,
                                                    public.app_level_rank(picked.level) desc, picked.ed_rank, picked.pos),
                     '[]'::jsonb) from picked),
    (select coalesce(jsonb_agg(sp.item order by sp.rn), '[]'::jsonb) from sp),
    (select coalesce(jsonb_agg(com.item order by array_position(v_communities, com.community_id), com.published_at desc),
                     '[]'::jsonb) from com where com.rn <= 3),
    (select good.item from good)
  into v_items, v_special, v_community, v_good;

  -- good news fallback: the newest good item of the reader's previous editions within 48 hours
  if v_good is null and cardinality(coalesce(p_regular, '{}')) > 0 then
    select i.item into v_good
    from public.app_reader_editions(p_lang, p_aud, p_prof.update_frequency, p_to - interval '48 hours', p_to) rr
    cross join lateral public.app_edition_items(rr.id, p_lang, p_aud, v_style, v_uid) i
    where rr.track <> 'special' and i.kind = 'good_news'
    order by rr.published_at desc, i.pos
    limit 1;
  end if;

  -- ad: free readers only; the ad of the newest edition in the feed that has one in the reader's language
  if not v_premium then
    for r in
      select e.id from public.tamzit_editions e
      where e.id = any(coalesce(p_regular, '{}')) order by e.created_at desc
    loop
      v_ad := public.app_ad_json(public.app_edition_ad(r.id, p_lang), p_lang);
      exit when v_ad is not null;
    end loop;
  end if;

  -- audio: of the newest edition in the feed that has a playable one; else the newest of the reader's editions
  -- in the last 24 hours (personal edition)
  for r in
    select e.id, e.main_text from public.tamzit_editions e
    where e.id = any(coalesce(p_regular, '{}')) order by e.created_at desc
  loop
    v_audio := public.app_edition_audio(r.id, 'האזנה · ' || coalesce(public.app_edition_title(r.main_text), 'תמצית החדשות'));
    exit when v_audio is not null;
  end loop;
  if v_audio is null and p_filter then
    for r in
      select rr.id, rr.main_text
      from public.app_reader_editions(p_lang, p_aud, p_prof.update_frequency, p_to - interval '24 hours', p_to) rr
      where rr.track <> 'special' and not (rr.id = any(coalesce(p_regular, '{}')))
      order by rr.published_at desc
    loop
      v_audio := public.app_edition_audio(r.id, 'האזנה · ' || coalesce(public.app_edition_title(r.main_text), 'תמצית החדשות'));
      exit when v_audio is not null;
    end loop;
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
           'has_audio', r.track <> 'special' and public.app_edition_audio(r.id) is not null,
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

-- ===========================================================================
-- Media copies: queue for app-media-sync, trigger and schedule
-- ===========================================================================

-- Queues new Drive files (images of the last 30 days; audio of the last 2 days, only where the news-audio bucket
-- has no copy, i.e. English), the news-audio mp3s of the last 3 days (key 'na:<object id>') and ad links, and
-- returns what is due: { files: [{drive_id, kind, source_url}], links: [{url}] }.
create or replace function public.app_media_queue(p_limit int default 6) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_files jsonb;
  v_links jsonb;
begin
  insert into public.app_media (drive_id, source_url, kind)
  select distinct on (public.app_drive_id(el.media_id)) public.app_drive_id(el.media_id), el.media_id,
         case when el.element_type = 'audio' then 'audio' end
  from public.tamzit_edition_elements el
  left join public.tamzit_editions le on le.id = el.edition_id
  where public.app_drive_id(el.media_id) is not null
    and ((el.element_type in ('ad', 'donation_campaign', 'cta_link') and el.created_at > now() - interval '30 days')
         or (el.element_type = 'audio' and el.created_at > now() - interval '2 days'
             and (le.language = 'english' or public.app_element_sent_lang(el.created_at) = 'english')))
  order by public.app_drive_id(el.media_id), el.id desc
  on conflict (drive_id) do nothing;

  insert into public.app_media (drive_id, source_url, kind, file_name, src_created_at, src_size)
  select 'na:' || so.id, public.app_storage_public_base() || '/news-audio/' || public.app_url_encode(so.name), 'audio',
         so.name, so.created_at, (so.metadata ->> 'size')::bigint
  from storage.objects so
  where so.bucket_id = 'news-audio' and so.created_at > now() - interval '3 days'
  on conflict (drive_id) do nothing;

  insert into public.app_link_previews (url)
  select distinct (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1]
  from public.tamzit_edition_elements el
  where el.element_type in ('ad', 'donation_campaign', 'cta_link') and el.created_at > now() - interval '30 days'
    and el.content_text ~ 'https?://'
  on conflict (url) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object('drive_id', m.drive_id, 'kind', m.kind, 'source_url', m.source_url)),
                  '[]'::jsonb) into v_files
  from (
    select m.drive_id, m.kind, m.source_url from public.app_media m
    where m.status in ('pending', 'private', 'failed') and m.next_try_at <= now() and m.tries < 40
    order by m.created_at desc
    limit p_limit
  ) m;
  select coalesce(jsonb_agg(jsonb_build_object('url', p.url)), '[]'::jsonb) into v_links
  from (
    select p.url from public.app_link_previews p
    where p.status in ('pending', 'failed') and p.next_try_at <= now() and p.tries < 8
    order by p.created_at desc
    limit p_limit
  ) p;
  return jsonb_build_object('files', v_files, 'links', v_links);
end;
$$;

-- Calls app-media-sync (asynchronously, after commit).
create or replace function public.app_media_kick() returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_url text := public.app_setting_text('functions_base_url');
begin
  if v_url is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/app-media-sync',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-app-secret', coalesce(public.app_setting_text('push_webhook_secret'), '')),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'app_media_kick: %', sqlerrm;
end;
$$;

create or replace function public.app_edition_elements_media() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.app_media_kick();
  return null;
end;
$$;

drop trigger if exists app_edition_elements_media on public.tamzit_edition_elements;
create trigger app_edition_elements_media
  after insert on public.tamzit_edition_elements
  for each statement execute function public.app_edition_elements_media();

do $$
begin
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'app-media-sync';
  perform cron.schedule('app-media-sync', '*/5 * * * *', 'select public.app_media_kick()');
end $$;

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
    'app_edition_title', 'app_editions_window', 'app_media_queue', 'app_edition_audio', 'app_section_split'];
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
