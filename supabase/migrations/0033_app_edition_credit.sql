-- Tamzit app: the edition's byline — who wrote it, and in French who translated it.
--
-- Every edition ends with its credit line ("כתיבה: הדר לבני.", "Author: Hadar Livny", "Rédaction: … / Traduction: …").
-- The parser drops that line from the items, as it should, so until now the reader never saw who wrote the edition.
-- It is now read out of the text and returned with the edition, the way a news site puts the reporter's name under
-- the headline. Special updates have no credit line, and then nothing is returned.
-- Idempotent.

-- The name out of a credit line: without the WhatsApp markup and without the full stop at its end.
create or replace function public.app_credit_name(p_value text) returns text
language sql immutable set search_path = public as $$
  select nullif(left(btrim(btrim(btrim(regexp_replace(coalesce(p_value, ''), '[*_~`]', '', 'g')), '.־- '), ' '), 120), '');
$$;

-- { "writer": "הדר לבני", "translator": null } — or null when the text carries no credit at all.
create or replace function public.app_edition_credit(p_text text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_line text;
  v_val text;
  v_writer text;
  v_translator text;
begin
  foreach v_line in array string_to_array(replace(coalesce(p_text, ''), E'\r', ''), E'\n') loop
    v_line := btrim(v_line);
    continue when v_line = '';
    if v_writer is null then
      v_val := substring(v_line from
        '^[*_~>[:space:]]*(?:כתיבה|נכתב על ידי|עריכה|Author|Writing|Written by|Editor|Rédaction|Écrit par)[[:space:]]*:[[:space:]]*(.+)$');
      if v_val is not null then
        v_writer := public.app_credit_name(v_val);
      end if;
    end if;
    if v_translator is null then
      v_val := substring(v_line from
        '^[*_~>[:space:]]*(?:תרגום|Translation|Translated by|Traduction|Traduit par)[[:space:]]*:[[:space:]]*(.+)$');
      if v_val is not null then
        v_translator := public.app_credit_name(v_val);
      end if;
    end if;
  end loop;
  if v_writer is null and v_translator is null then
    return null;
  end if;
  return jsonb_build_object('writer', v_writer, 'translator', v_translator);
end;
$$;

-- The two feeds that readers read an edition in (the personal edition and a single edition from the archive) now
-- carry 'credit'. Copied from migration 0013 with that one field added; nothing else in them changed.

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
    'credit', (select public.app_edition_credit(e.main_text) from public.tamzit_editions e where e.id = v_regular[1]),
    'notices', coalesce(public.app_feed_notices(v_regular), '[]'::jsonb),
    'next_edition', public.app_next_edition(
      v_prof, (select max(e.created_at) from public.tamzit_editions e where e.id = any(v_regular))));
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
    false, v_title, jsonb_build_array(public.app_edition_kind(e.edition_type, e.time_slot, v_title)))
    || jsonb_build_object('edition_id', e.id::text,
                          'credit', public.app_edition_credit(e.main_text),
                          'notices', coalesce(public.app_feed_notices(array[e.id]), '[]'::jsonb));
end;
$$;

grant execute on function public.app_credit_name(text) to anon, authenticated, service_role;
grant execute on function public.app_edition_credit(text) to anon, authenticated, service_role;
