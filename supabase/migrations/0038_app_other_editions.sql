-- Tamzit app: the reader is told about the editions that are not theirs.
--
-- A reader on "one edition a day" gets the daily edition at 21:00 and nothing else. Their screen therefore shows
-- yesterday's edition all day, with no sign that a morning edition came out — which reads exactly like an app that
-- stopped working (12.10: "I see yesterday evening's edition and no notification came"). Nothing was broken; the
-- setting was doing its job silently.
--
-- The personal edition now carries other_editions: what came out in the reader's language after the edition they
-- were given, and is not theirs. The app names them under the header and opens them on a tap. Older builds ignore
-- the field.
-- Copied from 0033 with that one field added; nothing else in it changed.

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
    -- editions of the reader's language published after the one they get, which are not theirs (a reader on one or
    -- two editions a day). The app names them and offers them, so an edition from yesterday never looks like a fault.
    'other_editions', case when v_auto and cardinality(v_regular) > 0 then (
       select coalesce(jsonb_agg(jsonb_build_object(
                'id', w.id::text,
                'kind', public.app_edition_kind(w.edition_type, w.time_slot, public.app_edition_title(w.main_text)),
                'title', public.app_edition_title(w.main_text),
                'published_at', w.published_at) order by w.published_at desc), '[]'::jsonb)
       from public.app_editions_window(v_lang, (select max(e.created_at) from public.tamzit_editions e
                                                where e.id = any(v_regular)), now()) w
       where w.track <> 'special' and not (w.id = any(v_regular))) else '[]'::jsonb end,
    'notices', coalesce(public.app_feed_notices(v_regular), '[]'::jsonb),
    'next_edition', public.app_next_edition(
      v_prof, (select max(e.created_at) from public.tamzit_editions e where e.id = any(v_regular))));
end;
$$;
