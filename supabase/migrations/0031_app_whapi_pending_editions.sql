-- Tamzit app: the WhatsApp fallback waits for the engine, and never takes an edition at an impossible hour.
--
-- What went wrong on 2.10.2026: a test posted in the editing room's channel at 01:11 was written at once as that
-- day's Hebrew morning edition. It pushed a notification to every device in the middle of the night, it was what
-- readers saw until the real morning edition arrived at 09:20, and it took the morning's push key — so the real
-- edition, when it came, pushed nothing (one push per language, track, slot and day).
--
-- Two things were wrong, not one:
-- (a) The fallback wrote the moment a message arrived, so it raced the engine on every ordinary edition (on 1.10 it
--     beat the engine by eight minutes) instead of only filling in when the engine fails. Now a message that looks
--     like an edition is parked in app_whapi_pending and written only after whatsapp_edition_delay_minutes (20) have
--     passed and the engine still has not written that edition. Due rows are handled whenever another WhatsApp
--     message arrives and by the hourly housekeeping — no new polling.
-- (b) Nothing checked that the hour made sense. A morning edition at 01:11 is not a morning edition. Each slot now
--     has the hours it may arrive in (app_settings.edition_slot_hours, Israel time).
-- Idempotent.

create table if not exists public.app_whapi_pending (
  id          bigint generated always as identity primary key,
  text_hash   text not null,
  main_text   text not null,
  language    text not null,
  edition_type text not null,
  time_slot   text not null,
  edition_date date not null,
  sent_at     timestamptz not null,
  due_at      timestamptz not null,
  message_id  text,
  done_at     timestamptz,
  outcome     text,                      -- written | engine_wrote_it | too_late | null while waiting
  edition_id  bigint,
  created_at  timestamptz not null default now()
);
alter table public.app_whapi_pending enable row level security;
revoke all on public.app_whapi_pending from anon, authenticated;
create unique index if not exists app_whapi_pending_text_idx on public.app_whapi_pending (text_hash, edition_date);
create index if not exists app_whapi_pending_due_idx on public.app_whapi_pending (due_at) where done_at is null;

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('whatsapp_edition_delay_minutes', '20'::jsonb, 'כמה זמן ממתינים למנוע לפני קליטה מוואטסאפ',
   E'מה זה: כשמהדורה נשלחת בוואטסאפ והמנוע עוד לא רשם אותה, האפליקציה ממתינה כך וכך דקות לפני שהיא כותבת אותה בעצמה. ההמתנה נותנת למנוע להספיק לרשום, כדי שהרישום שלו יהיה זה שקובע, והקליטה מוואטסאפ תתפוס רק כשהוא באמת נכשל.\n'
   'על מה זה משפיע: כמה מאוחר תופיע מהדורה שהמנוע לא רשם (ובהתאם, מתי תצא עליה ההתראה). ערך קטן מדי מחזיר את המצב שבו קליטה מוואטסאפ מקדימה את המנוע; ערך גדול מדי מאחר את המהדורה.\n'
   'איפה זה ממומש: שרת: public.app_ingest_edition ו-public.app_ingest_due_editions (מיגרציה 0031).\n'
   'פורמט: מספר שלם של דקות, בין 0 ל-180.',
   'מערכת', 'int', '{"min": 0, "max": 180}'::jsonb, '20'::jsonb, false, false, 5045),
  ('edition_slot_hours', '{"morning": [4, 12], "noon": [10, 17], "evening": [16, 24], "daily": [16, 24]}'::jsonb,
   'השעות שבהן כל מועד מהדורה סביר',
   E'מה זה: לכל מועד (בוקר, צוהריים, ערב, יומי) השעות בשעון ישראל שבהן סביר שהמהדורה תישלח. הודעה שנראית כמו מהדורה ומגיעה בוואטסאפ מחוץ לשעות האלה לא נקלטת. כך בדיקה שנשלחת בלילה מחדר העריכה לא הופכת למהדורת הבוקר של הקוראים.\n'
   'על מה זה משפיע: רק על קליטה מוואטסאפ. מה שהמנוע רושם נכנס תמיד, בכל שעה.\n'
   'איפה זה ממומש: שרת: public.app_slot_hour_ok (מיגרציה 0031).\n'
   'פורמט: אובייקט בסוגריים מסולסלים, מפתח לכל מועד (morning, noon, evening, daily) וזוג שעות [משעה, עד שעה]. דוגמה: {"morning": [4, 12]}.',
   'מערכת', 'json', '{}'::jsonb,
   '{"morning": [4, 12], "noon": [10, 17], "evening": [16, 24], "daily": [16, 24]}'::jsonb, false, false, 5046)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- Is this a sensible hour (Israel time) for an edition of this slot to be sent?
create or replace function public.app_slot_hour_ok(p_edition_type text, p_time_slot text, p_at timestamptz)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_slot text := public.app_edition_slot(p_edition_type, p_time_slot);
  v_win jsonb := public.app_setting_json('edition_slot_hours') -> v_slot;
  v_hour numeric := extract(hour from (p_at at time zone 'Asia/Jerusalem'))
                    + extract(minute from (p_at at time zone 'Asia/Jerusalem')) / 60.0;
begin
  if v_win is null or jsonb_array_length(v_win) <> 2 then
    return true;            -- no window configured for this slot: nothing to object to
  end if;
  return v_hour >= (v_win ->> 0)::numeric and v_hour < (v_win ->> 1)::numeric;
end;
$$;

-- A regular edition seen on WhatsApp: parked, not written. It is written later (app_ingest_due_editions) only if the
-- engine still has not written that edition. Returns the pending row's id, or null when it is not taken at all.
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
  -- a morning edition does not arrive at one in the morning: that is a test, or something else entirely
  if not public.app_slot_hour_ok(k.edition_type, k.time_slot, v_at) then
    return null;
  end if;
  -- what the reader would see: a notice under the same header ("המהדורה הבאה תישלח …") has no items at all
  select count(*) into v_items from public.app_parse_edition(v_text, k.edition_type) p where p.kind = 'news';
  if v_items < 2 then
    return null;
  end if;
  insert into public.app_whapi_pending
    (text_hash, main_text, language, edition_type, time_slot, edition_date, sent_at, due_at, message_id)
  values (md5(v_text), v_text, k.language, k.edition_type, k.time_slot, v_date, v_at,
          v_at + make_interval(mins => least(greatest(public.app_setting_int('whatsapp_edition_delay_minutes', 20), 0), 180)),
          p_message_id)
  on conflict (text_hash, edition_date) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Writes the editions whose wait is over and which the engine never wrote. Returns how many were written.
create or replace function public.app_ingest_due_editions() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id bigint;
  v_n int := 0;
begin
  for r in
    select * from public.app_whapi_pending
    where done_at is null and due_at <= now()
    order by sent_at
    limit 20
    for update skip locked
  loop
    -- the engine (or an earlier pending row) wrote this edition in the meantime: nothing to do
    if exists (select 1 from public.tamzit_editions e
               where e.language = r.language and e.edition_type = r.edition_type and e.edition_date = r.edition_date
                 and public.app_edition_slot(e.edition_type, e.time_slot)
                     = public.app_edition_slot(r.edition_type, r.time_slot)) then
      update public.app_whapi_pending set done_at = now(), outcome = 'engine_wrote_it' where id = r.id;
      continue;
    end if;
    -- far too late to be worth showing as that edition (a day old)
    if r.sent_at < now() - interval '24 hours' then
      update public.app_whapi_pending set done_at = now(), outcome = 'too_late' where id = r.id;
      continue;
    end if;
    insert into public.tamzit_editions (created_at, edition_date, main_text, language, edition_type, time_slot)
    values (r.sent_at, r.edition_date, r.main_text, r.language, r.edition_type, r.time_slot)
    returning id into v_id;
    insert into public.app_whapi_editions (edition_id, message_id) values (v_id, r.message_id);
    update public.app_whapi_pending set done_at = now(), outcome = 'written', edition_id = v_id where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- One WhatsApp message: a special update, an edition (parked), or an ad. Every message also gives the parked
-- editions whose wait is over their chance, so nothing new has to poll.
create or replace function public.app_ingest_sent(p_text text, p_at timestamptz, p_message_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_due int;
begin
  v_due := public.app_ingest_due_editions();
  if public.app_is_special_text(p_text) then
    return jsonb_build_object('kind', 'special', 'id', public.app_ingest_special(p_text, p_at), 'due', v_due);
  end if;
  if (public.app_edition_of_text(p_text)).language is not null then
    return jsonb_build_object('kind', 'edition', 'id', null, 'parked',
                              public.app_ingest_edition(p_text, p_at, p_message_id), 'due', v_due);
  end if;
  if btrim(coalesce(p_text, '')) ~ '^>' then
    return jsonb_build_object('kind', 'ad', 'id', public.app_ingest_ad(p_text, p_at), 'due', v_due);
  end if;
  return case when v_due > 0 then jsonb_build_object('due', v_due) else '{}'::jsonb end;
end;
$$;

-- The hourly check also writes the parked editions that are due (and nothing else changed here).
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
  perform public.app_ingest_due_editions();
  delete from public.app_events
  where created_at < now() - make_interval(days => least(greatest(public.app_setting_int('events_keep_days', 180), 7), 730));
end;
$$;

revoke execute on function public.app_slot_hour_ok(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.app_ingest_due_editions() from public, anon, authenticated;
revoke execute on function public.app_ingest_edition(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.app_ingest_sent(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.app_housekeeping() from public, anon, authenticated;
grant execute on function public.app_slot_hour_ok(text, text, timestamptz) to service_role;
grant execute on function public.app_ingest_due_editions() to service_role;
grant execute on function public.app_ingest_edition(text, timestamptz, text) to service_role;
grant execute on function public.app_ingest_sent(text, timestamptz, text) to service_role;
