-- Tamzit app: an edition written as bullets alone, and never writing an edition the reader would see empty.
--
-- On 2.10.2026 the morning edition came in a new shape: the header, then four bullets, each opening with a bold
-- lead-in — and no "📌 *_ביטחון:_*" section headings. The parser opens items only under a heading, so the edition
-- parsed into nothing, and the app showed "אין עדיין ידיעות במהדורה" with the edition's own text behind it.
--
-- (a) app_parse_edition reads the text twice: as before, and — only when that found nothing — treating every bullet
--     from the first one on as an item with no section (promo and "follow us" lines stay out). In that shape a bold
--     lead-in counts as the item's headline even without a colon after it. Checked against all 2,207 editions in the
--     table: 2,206 parse exactly as before, and the one that parsed into nothing now gives its four items.
-- (b) app_ingest_edition only writes an edition from WhatsApp when the parser finds at least two items in it, so a
--     message that looks like an edition but reads as nothing never reaches the app.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.app_parse_edition(p_text text, p_edition_type text)
 RETURNS TABLE(n integer, section text, subsection text, kind text, headline text, body text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_lines text[] := regexp_split_to_array(replace(coalesce(p_text, ''), E'\r', ''), E'\n');
  v_special boolean := p_edition_type = 'special_update';
  v_active boolean := v_special;
  v_open boolean := false;
  v_section text := null;
  v_kind text := 'news';
  v_flat boolean := false;      -- an edition written as bullets only, with no section headings
  attempt int;
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
  c_deny constant text := public.app_regex_any(public.app_setting_texts('parser_skip_section_words',
    array['ערוץ', 'וואטסאפ', 'whatsapp', 'טלגרם', 'telegram', 'עוקבים', 'לשיתוף', 'הצטרפו', 'קמפיין', 'שליחת העדכונים', 'התנצלות', 'קוראים יקרים', 'dear readers', 'chers lecteurs', 'facebook', 'פייסבוק', 'בחסות', 'שיווקי', 'פרסומת', 'sponsor', 'publicit', 'annonce', 'promo', '>>']));
  c_good constant text := public.app_regex_any(public.app_setting_texts('parser_good_news_words',
    array['ונסיים בטוב', 'positive note', 'good note', 'note positive', 'bonne note']));
  c_url constant text := '^(https?://[^[:space:]]+|[A-Za-z0-9.-]+\.(co\.il|org\.il|com|il)/[^[:space:]]*)$';
begin
  -- Pass 1 reads the usual edition: a section heading ("📌 *_ביטחון:_*") opens the items under it. An edition
  -- written as bullets alone, with no headings (the format of 2.10.2026), yields nothing there; pass 2 then takes
  -- every bullet from the first one on, under no section.
  for attempt in 1 .. 2 loop
  v_flat := attempt = 2;
  a_section := '{}'; a_kind := '{}'; a_raw := '{}';
  v_section := null; v_kind := 'news'; v_open := false;
  v_active := v_special;
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

    if v_flat then
      if s ~ '^•' then
        v_active := true;
      elsif s ~ '^✓' or s ~* c_deny then
        continue;                                   -- a promo or "follow us" line, never an item
      end if;
    elsif not v_special and s !~ '^(•|✓)' then
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
  exit when cardinality(a_raw) > 0 or v_special;     -- pass 2 only when pass 1 found nothing
  end loop;

  for i in 1 .. cardinality(a_raw) loop
    m := regexp_match(a_raw[i], '^[[:space:]]*\*([^*\n]{2,120})\*[[:space:]]*([:\-–—])?[[:space:]]*(.*)$');
    if m is not null and (m[1] ~ ':[[:space:]]*$' or m[2] is not null or v_flat) and btrim(m[3]) <> '' then
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
$function$;

-- (b) A regular edition from WhatsApp, now also requiring that the reader will have something to read.
create or replace function public.app_ingest_edition(p_text text, p_at timestamptz, p_message_id text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(replace(coalesce(p_text, ''), E'\r', ''));
  v_at timestamptz := least(coalesce(p_at, now()), now());
  v_date date := (v_at at time zone 'Asia/Jerusalem')::date;
  k record;
  v_items int;
  v_id bigint;
begin
  if not public.app_setting_bool('whatsapp_editions_fallback', true) then
    return null;
  end if;
  select * into k from public.app_edition_of_text(v_text);
  if k.language is null or length(v_text) < 300 then
    return null;
  end if;
  -- what the reader would see: a notice under the same header ("המהדורה הבאה תישלח …") has no items at all
  select count(*) into v_items from public.app_parse_edition(v_text, k.edition_type) p where p.kind = 'news';
  if v_items < 2 then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('app_ingest_edition:' || k.language || ':' || k.edition_type || ':'
                                         || public.app_edition_slot(k.edition_type, k.time_slot) || ':' || v_date));
  if exists (select 1 from public.tamzit_editions e
             where e.language = k.language and e.edition_type = k.edition_type and e.edition_date = v_date
               and public.app_edition_slot(e.edition_type, e.time_slot) = public.app_edition_slot(k.edition_type, k.time_slot)) then
    return null;
  end if;
  insert into public.tamzit_editions (created_at, edition_date, main_text, language, edition_type, time_slot)
  values (v_at, v_date, v_text, k.language, k.edition_type, k.time_slot)
  returning id into v_id;
  insert into public.app_whapi_editions (edition_id, message_id) values (v_id, p_message_id);
  return v_id;
end;
$$;

revoke execute on function public.app_ingest_edition(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.app_ingest_edition(text, timestamptz, text) to service_role;

-- The cached item count of an edition is written when the engine saves it (app_edition_stats). An edition that
-- parsed into nothing before (a) keeps a count of 0 in that cache, and the archive reads the cache, so refresh them.
update public.app_edition_stats s
   set item_count = public.app_edition_item_count(e.id, e.main_text, e.edition_type),
       title = public.app_edition_title(e.main_text),
       computed_at = now()
  from public.tamzit_editions e
 where e.id = s.edition_id
   and s.item_count = 0
   and public.app_edition_item_count(e.id, e.main_text, e.edition_type) > 0;
