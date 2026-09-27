-- Tamzit app: the personal edition shows a new edition as soon as it is published.
-- The app asks for the window between the reader's last two slots (e.g. 16:00–21:30), and the default slots come a
-- little after the newsroom publishes (10:00, 16:00, 21:30). So between an edition's publication (~09:20) and the
-- reader's next slot (10:00) the app kept showing the previous edition. Now, when the app asks for its newest window
-- (p_to in the last 26 hours) and the reader's editions already went out after p_to, the window becomes (p_to, now]:
-- the new edition. For one edition a day that means a new daily edition (not the day's classic ones). Idempotent.

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

revoke execute on function public.app_personal_edition(timestamptz, timestamptz) from public, anon;
grant execute on function public.app_personal_edition(timestamptz, timestamptz) to authenticated, service_role;
