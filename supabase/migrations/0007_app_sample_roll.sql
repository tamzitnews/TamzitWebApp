-- Keep the SAMPLE content (external_id 'sample-%') current until the production engine feeds real data.
-- A daily job moves all sample editions, items, audio and ads forward by whole weeks whenever the
-- newest sample edition is more than 2 days old, so the demo always has a fresh week of editions on
-- the same weekdays (Shabbat gaps stay aligned). Special editions are not moved (no repeated pushes).
-- Remove when the engine goes live:  select cron.unschedule('app_sample_roll_weekly');

create or replace function public.app_sample_roll_forward() returns int
language plpgsql security definer set search_path = public as $$
declare
  newest timestamptz;
  weeks int;
  shift interval;
begin
  select max(published_at) into newest from app_editions
   where external_id like 'sample-%' and edition_type <> 'special';
  if newest is null or newest > now() - interval '2 days' then
    return 0;
  end if;
  weeks := ceil(extract(epoch from (now() - newest)) / (7 * 86400.0))::int;
  shift := make_interval(weeks => weeks);
  update app_editions set published_at = published_at + shift
   where external_id like 'sample-%' and edition_type <> 'special';
  update app_items i set published_at = i.published_at + shift
   where i.external_id like 'sample-%'
     and not exists (select 1 from app_edition_items ei join app_editions e on e.id = ei.edition_id
                      where ei.item_id = i.id and e.edition_type = 'special');
  update app_audio set published_at = published_at + shift where external_id like 'sample-%';
  update app_ads set starts_at = starts_at + shift, ends_at = ends_at + shift where external_id like 'sample-%';
  return weeks;
end $$;

revoke all on function public.app_sample_roll_forward() from public, anon, authenticated;

-- Daily at 00:10 UTC (02:10/03:10 Israel).
select cron.schedule('app_sample_roll_weekly', '10 0 * * *', 'select public.app_sample_roll_forward()');

-- Richer demo editions: sample items in the default onboarding topics are at least 'important', so a
-- new reader with the default settings sees a full edition.
update app_items set level = 'important'
 where external_id like 'sample-%' and kind = 'news' and level = 'general'
   and topic_id in (select id from app_topics where is_default);
