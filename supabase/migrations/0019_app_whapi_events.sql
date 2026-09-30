-- Tamzit app: WhatsApp sends (Whapi) drive the background work; no polling.
--
-- (a) Special updates: since 2026-08-18 the engine no longer writes the special updates it sends to tamzit_editions,
--     so the app, its archive and its pushes never saw them. The app-whapi edge function receives Whapi's webhook
--     for every message the service's numbers send; a message whose first line is the special-update header
--     ("📻 *עדכון מיוחד*", "Special update", "Mise à jour spéciale") is written here once per distinct text
--     (app_ingest_special), exactly as the engine used to write it (edition_type special_update, time_slot
--     'עדכון מיוחד'). The row then pushes (special channel), shows in the feed and the archive, and is classified.
-- (b) The 5-minute cron jobs of app-media-sync and app-classify are gone. Both run when something is sent: new
--     tamzit_edition_elements rows (app_media_kick), a new edition text (app_label_kick), a WhatsApp send (app-whapi).
--     One hourly job only checks, in SQL, whether an English audio copy is due for deletion (never kept more than a
--     day) or a failed classification is due for a retry, and starts the function only then.
-- Idempotent.

-- Secret Whapi sends back in the x-whapi-secret header (set on the webhook by app-whapi, action "connect").
insert into public.app_settings (key, value) values ('whapi_webhook_secret', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;
update public.app_settings set
  title = 'סוד פנימי לאימות ה-webhook של Whapi',
  description = E'מה זה: סוד ש-Whapi שולח בכל קריאה ל-app-whapi (בכותרת x-whapi-secret), כדי שרק Whapi יוכל להפעיל אותה. נוצר אוטומטית, ו-app-whapi מגדירה אותו ב-Whapi.\n'
    'על מה זה משפיע: אם הוא לא תואם, הודעות מ-Whapi נדחות: עדכונים מיוחדים לא ייכנסו ותמונות פרסומת לא יישמרו. לא לשנות ולא לשתף.\n'
    'איפה זה ממומש: שרת: supabase/functions/app-whapi/index.ts.\n'
    'פורמט: טקסט בתוך מירכאות כפולות.',
  category = 'מערכת', value_type = 'text', constraints = '{}'::jsonb, default_value = null,
  is_public = false, is_secret = true, sort = 5020
where key = 'whapi_webhook_secret';

-- The special-update header, in the three languages.
create or replace function public.app_is_special_text(p text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(split_part(btrim(coalesce(p, '')), E'\n', 1), '')
         ~* '^[^[:alnum:]]*(עדכון מיוחד|special update|mise à jour spéciale|mise a jour speciale)[^[:alnum:]]*$';
$$;

-- Writes a special update that was sent on WhatsApp, once per distinct text (a repeat within 3 days is skipped).
-- Returns the new tamzit_editions id, or null when it was already there.
create or replace function public.app_ingest_special(p_text text, p_at timestamptz) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(replace(coalesce(p_text, ''), E'\r', ''));
  v_at timestamptz := least(coalesce(p_at, now()), now());
  v_lang text := public.app_lang_name(public.app_text_lang(v_text));
  v_id bigint;
begin
  if not public.app_is_special_text(v_text) or v_lang is null then
    return null;
  end if;
  -- one row per text (several numbers and groups get the same message)
  perform pg_advisory_xact_lock(hashtext('app_ingest_special:' || md5(v_text)));
  if exists (select 1 from public.tamzit_editions e
             where e.edition_type = 'special_update' and md5(btrim(replace(e.main_text, E'\r', ''))) = md5(v_text)
               and e.created_at between v_at - interval '3 days' and v_at + interval '3 days') then
    return null;
  end if;
  insert into public.tamzit_editions (created_at, edition_date, main_text, language, edition_type, time_slot)
  values (v_at, (v_at at time zone 'Asia/Jerusalem')::date, v_text, v_lang, 'special_update', 'עדכון מיוחד')
  returning id into v_id;
  return v_id;
end;
$$;

-- Hourly, in SQL: start app-media-sync only when an English audio copy is due for deletion, and app-classify only when
-- a failed classification is due for a retry. Nothing runs otherwise.
create or replace function public.app_housekeeping() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.app_media m
             where m.status = 'ok' and m.kind in ('audio', 'video')
               and m.created_at < now() - make_interval(hours =>
                     least(greatest(public.app_setting_int('english_audio_keep_hours', 24), 1), 24))) then
    perform public.app_media_kick();
  end if;
  if exists (select 1 from public.app_item_labels l where l.status = 'failed' and l.next_try_at <= now() and l.tries < 6) then
    perform public.app_label_kick();
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'app-media-sync') then
    perform cron.unschedule('app-media-sync');
  end if;
  if exists (select 1 from cron.job where jobname = 'app-classify') then
    perform cron.unschedule('app-classify');
  end if;
  if exists (select 1 from cron.job where jobname = 'app-housekeeping') then
    perform cron.unschedule('app-housekeeping');
  end if;
  perform cron.schedule('app-housekeeping', '7 * * * *', 'select public.app_housekeeping()');
end;
$$;

revoke execute on function public.app_is_special_text(text) from public, anon, authenticated;
revoke execute on function public.app_ingest_special(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.app_housekeeping() from public, anon, authenticated;
grant execute on function public.app_is_special_text(text) to service_role;
grant execute on function public.app_ingest_special(text, timestamptz) to service_role;

-- The service's WhatsApp channels: their posts count even when an editor posted them from another phone (special
-- updates). Filled by app-whapi (action "connect": the channels the numbers administer).
insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('whapi_channel_ids', '[]'::jsonb, 'ערוצי הוואטסאפ של השירות',
   E'מה זה: מזהי ערוצי הוואטסאפ של תמצית החדשות (למשל "120363259815704918@newsletter"). פוסט באחד מהם נחשב של השירות גם כשעורך פרסם אותו מהטלפון שלו, ולא דרך המספר המחובר ל-Whapi. כך נקלטים עדכונים מיוחדים.\n'
   'על מה זה משפיע: אילו עדכונים מיוחדים נכנסים לאפליקציה (למהדורה, לארכיון ולהתראות).\n'
   'איפה זה ממומש: שרת: supabase/functions/_shared/whapi.ts (handleSent) ו-supabase/functions/app-whapi/index.ts. נמלא אוטומטית בפעולה connect, לפי הערוצים שהמספר מנהל בהם.\n'
   'פורמט: רשימה בסוגריים מרובעים של מזהים במירכאות כפולות. דוגמה: ["120363259815704918@newsletter"].',
   'מערכת', 'text_list', '{"max_items": 20}'::jsonb, '[]'::jsonb, false, false, 5030)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- The ad whose text this caption is: as in 0014, and the caption must not be much longer than the ad (an edition's
-- caption contains its ad's text too, but it is not that ad's image).
create or replace function public.app_ad_element_for_caption(p_caption text, p_at timestamptz) returns bigint
language sql stable security definer set search_path = public as $$
  with c as (select public.app_ad_norm(p_caption) as t)
  select el.id
  from public.tamzit_edition_elements el, c
  where el.element_type in ('ad', 'donation_campaign', 'cta_link')
    and coalesce(btrim(el.content_text), '') <> ''
    and el.created_at between coalesce(p_at, now()) - interval '1 day' and coalesce(p_at, now()) + interval '1 hour'
    and length(c.t) >= 20
    and length(c.t) <= 2 * length(public.app_ad_norm(el.content_text)) + 80
    and (position(left(c.t, 60) in public.app_ad_norm(el.content_text)) > 0
         or position(left(public.app_ad_norm(el.content_text), 60) in c.t) > 0)
  order by abs(extract(epoch from el.created_at - coalesce(p_at, now()))), el.id desc
  limit 1;
$$;
