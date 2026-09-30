-- Tamzit app: a faster archive.
-- app_archive parsed every edition of the window to count its items and looked for audio on each: ~0.45 s for a month.
-- Now the item count and the title are computed once, when an edition is written (trigger on tamzit_editions, also
-- when its text changes), into app_edition_stats; and only editions of the last two days are checked for audio (the
-- engine's mp3s and the English copies are deleted after a day). Output unchanged. Idempotent.

create table if not exists public.app_edition_stats (
  edition_id   bigint primary key,           -- tamzit_editions.id
  item_count   int not null,
  title        text,
  computed_at  timestamptz not null default now()
);
alter table public.app_edition_stats enable row level security;   -- server only (no policies)
revoke all on public.app_edition_stats from anon, authenticated;

-- News items of an edition: its story elements when it has them, else its parsed news items.
create or replace function public.app_edition_item_count(p_id bigint, p_text text, p_type text) returns int
language sql stable security definer set search_path = public as $$
  select case
              when exists (select 1 from public.tamzit_edition_elements el
                           where el.edition_id = p_id and el.element_type = 'story' and el.story_id is not null)
                then (select count(*) from public.tamzit_edition_elements el
                      join public.processed_stories s on s.id = el.story_id
                      where el.edition_id = p_id and el.element_type = 'story'
                        and coalesce(s.kind, 'news') = 'news' and coalesce(s.status, 'published') = 'published')
              else (select count(*) from public.app_parse_edition(p_text, p_type) p where p.kind = 'news')
            end::int;
$$;

create or replace function public.app_edition_stats_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.app_edition_stats as s (edition_id, item_count, title, computed_at)
    values (new.id, public.app_edition_item_count(new.id, new.main_text, new.edition_type),
            public.app_edition_title(new.main_text), now())
    on conflict (edition_id) do update set item_count = excluded.item_count, title = excluded.title,
                                           computed_at = excluded.computed_at;
  exception when others then
    raise warning 'app_edition_stats_row: %', sqlerrm;   -- never fails the engine's write
  end;
  return new;
end;
$$;

drop trigger if exists app_tamzit_editions_stats on public.tamzit_editions;
create trigger app_tamzit_editions_stats after insert or update of main_text, edition_type on public.tamzit_editions
  for each row execute function public.app_edition_stats_row();

-- existing editions
insert into public.app_edition_stats (edition_id, item_count, title)
select e.id, public.app_edition_item_count(e.id, e.main_text, e.edition_type), public.app_edition_title(e.main_text)
from public.tamzit_editions e
on conflict (edition_id) do nothing;

CREATE OR REPLACE FUNCTION public.app_archive(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           -- cached at write time; an edition built from story elements (written after the edition row) is counted live
           'item_count', case when st.item_count is not null
                               and not exists (select 1 from public.tamzit_edition_elements el
                                               where el.edition_id = r.id and el.element_type = 'story')
                              then st.item_count
                              else public.app_edition_item_count(r.id, r.main_text, r.edition_type) end,
           -- the engine's audio and the English copies are gone after a day: only recent editions can have one
           'has_audio', r.track <> 'special' and r.published_at > now() - interval '2 days'
                        and public.app_edition_audio(r.id) is not null,
           'read', exists (select 1 from public.app_reads rd
                           where rd.profile_id = v_prof.user_id and rd.edition_key = r.id::text),
           'locked', (not v_premium and r.published_at < now() - make_interval(days => v_free)),
           'track', r.track
         ) order by r.published_at desc), '[]'::jsonb)
  into v_out
  from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, now() - make_interval(days => v_days), now()) r
  left join public.app_edition_stats st on st.edition_id = r.id
  cross join lateral (select coalesce(st.title, public.app_edition_title(r.main_text)) as title) x;
  return v_out;
end;
$function$;

revoke execute on function public.app_edition_item_count(bigint, text, text) from public, anon, authenticated;
revoke execute on function public.app_edition_stats_row() from public, anon, authenticated;
