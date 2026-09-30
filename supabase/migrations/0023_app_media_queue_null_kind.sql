-- Tamzit app: Drive files whose kind is not known yet (an ad image before its first download) are retried at any age.
-- In app_media_queue, "not (m.kind = 'audio' and …)" was NULL for kind NULL once the row was older than the audio
-- window, so such files were never retried (e.g. after the Drive folder was shared). Only this line changes.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.app_media_queue(p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_files jsonb;
  v_links jsonb;
  -- English audio copies live at most a day (english_audio_keep_hours, capped at 24)
  v_audio_keep interval := make_interval(hours => least(greatest(public.app_setting_int('english_audio_keep_hours', 24), 1), 24));
begin
  insert into public.app_media (drive_id, source_url, kind)
  select distinct on (public.app_drive_id(el.media_id)) public.app_drive_id(el.media_id), el.media_id,
         case when el.element_type = 'audio' then 'audio' end
  from public.tamzit_edition_elements el
  left join public.tamzit_editions le on le.id = el.edition_id
  where public.app_drive_id(el.media_id) is not null
    and ((el.element_type in ('ad', 'donation_campaign', 'cta_link') and el.created_at > now() - make_interval(days => public.app_setting_int('ad_image_days', 30)))
         or (el.element_type = 'audio' and el.created_at > now() - v_audio_keep
             and (le.language = 'english' or public.app_element_sent_lang(el.created_at) = 'english')))
  order by public.app_drive_id(el.media_id), el.id desc
  on conflict (drive_id) do nothing;

  insert into public.app_link_previews (url)
  select distinct (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1]
  from public.tamzit_edition_elements el
  where el.element_type in ('ad', 'donation_campaign', 'cta_link') and el.created_at > now() - make_interval(days => public.app_setting_int('ad_image_days', 30))
    and el.content_text ~ 'https?://'
  on conflict (url) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object('drive_id', m.drive_id, 'kind', m.kind)), '[]'::jsonb) into v_files
  from (
    select m.drive_id, m.kind from public.app_media m
    where m.status in ('pending', 'private', 'failed') and m.next_try_at <= now() and m.tries < 40
      and not (coalesce(m.kind, '') = 'audio' and m.created_at < now() - v_audio_keep)   -- too old to be worth copying
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
$function$;
