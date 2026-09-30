-- Tamzit app: the ad image as it went out on WhatsApp, taken from Whapi.Cloud (the service sends its WhatsApp
-- messages through Whapi, not WaSender: the app-wasender webhook of 0014 is removed; app_ad_images and the caption
-- matching stay).
--
-- app-media-sync (every 5 minutes) asks app_ad_images_needed which ads of the last whapi_lookback_hours still have no
-- image. If there are any and the WHAPI_TOKEN secret is set (the API token of each sending number; several separated
-- by commas), it lists the messages those numbers sent since then (GET https://gate.whapi.cloud/messages/list
-- ?from_me=true), takes the image messages whose caption is an ad's text (app_ad_element_for_caption), downloads the
-- image (the message's media link, or GET /media/{id}) into app-media/whapi/ and records it in app_ad_images
-- (source 'whapi'). Nothing to configure in Whapi. Idempotent.

alter table public.app_ad_images alter column source set default 'whapi';
comment on table public.app_ad_images is
  'The image each ad went out with on WhatsApp (from Whapi, by app-media-sync); app_ad_json shows it first.';

-- Ads of the last p_hours (default whapi_lookback_hours) with no image of their own and no image of an identical ad
-- (app_ad_json reuses those): { ids: [element id…], since: the oldest one's created_at }.
create or replace function public.app_ad_images_needed(p_hours int default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with el as (
    select e.id, e.created_at
    from public.tamzit_edition_elements e
    where e.element_type in ('ad', 'donation_campaign', 'cta_link')
      and coalesce(btrim(e.content_text), '') <> ''
      and e.created_at > now() - make_interval(hours =>
            least(greatest(coalesce(p_hours, public.app_setting_int('whapi_lookback_hours', 6)), 1), 48))
      and not exists (select 1 from public.app_ad_images i
                      join public.tamzit_edition_elements o on o.id = i.element_id
                      where i.element_id = e.id
                         or (public.app_ad_norm(o.content_text) = public.app_ad_norm(e.content_text)
                             and o.created_at > e.created_at - interval '30 days'))
  )
  select jsonb_build_object('ids', coalesce(jsonb_agg(el.id order by el.id), '[]'::jsonb), 'since', min(el.created_at))
  from el;
$$;

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('whapi_lookback_hours', '6'::jsonb, 'כמה שעות אחורה מחפשים את תמונת הפרסומת ב-Whapi',
   E'מה זה: פרסומות מהשעות האלה שעדיין אין להן תמונה מחפשות את התמונה שיצאה איתן בוואטסאפ: הודעת תמונה שהכיתוב שלה הוא טקסט הפרסומת, מתוך ההודעות שהמספרים של השירות שלחו דרך Whapi. החיפוש רץ רק אם הוגדר הסוד WHAPI_TOKEN ב-Supabase (Edge Functions → Secrets): טוקן ה-API של כל מספר שולח, כמה טוקנים מופרדים בפסיקים.\n'
   'על מה זה משפיע: התמונה שמוצגת בפרסומת באפליקציה. בלי תמונה מוואטסאפ מוצגת התמונה שצורפה ב-Drive, ואם גם היא חסרה, תמונת התצוגה המקדימה של הקישור.\n'
   'איפה זה ממומש: שרת: public.app_ad_images_needed (מיגרציה 0017), ופונקציית הקצה supabase/functions/app-media-sync (whapi.ts), שרצה כל 5 דקות.\n'
   'פורמט: מספר שלם, בלי מירכאות, בין 1 ל-48. דוגמה: 6.',
   'פרסומות ואודיו', 'int', '{"min": 1, "max": 48}'::jsonb, '6'::jsonb, false, false, 455)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

revoke execute on function public.app_ad_images_needed(int) from public, anon, authenticated;
grant execute on function public.app_ad_images_needed(int) to service_role;
