-- Tamzit app: when an edition does not arrive on time, the operators hear about it from us.
--
-- Three times in ten days an edition reached readers late or not at all, and every time the first to notice was a
-- person: a test edition taken as the morning edition (2.10), the Whapi webhook silently removed from the number so
-- the WhatsApp fallback went deaf (4.10), and a parked edition that became due with nothing to write it (10.10).
-- In each case the data said plainly that a scheduled edition had not been written or had not pushed — nobody asked.
--
-- Now something asks. app_expected_editions reads the service's own schedule (app_settings.edition_schedule, the
-- calendar's chol hamoed days and Jerusalem's rest periods) and says which Hebrew editions are due today and when.
-- app_missed_editions compares that with what was actually written and pushed, after a grace period
-- (edition_alert_grace_minutes, 30). app_edition_watchdog alerts the operators — a push to their own devices, once
-- per slot per day — and points the app-watch cron job at the next check. No polling: the job exists only when a
-- check is pending.
-- Idempotent.

create table if not exists public.app_edition_alerts (
  day        date not null,
  slot       text not null,
  due_at     timestamptz not null,
  reason     text not null,                 -- missing | not_pushed
  alerted_at timestamptz not null default now(),
  primary key (day, slot)
);
alter table public.app_edition_alerts enable row level security;
revoke all on public.app_edition_alerts from anon, authenticated;

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('edition_alert_grace_minutes', '30'::jsonb, 'כמה זמן אחרי השעה הקבועה מתריעים שמהדורה לא הגיעה',
   E'מה זה: לכל מהדורה יש שעה קבועה בלוח (edition_schedule). אם עברו כך וכך דקות מהשעה הזאת והמהדורה לא נרשמה, או שנרשמה ולא יצאה עליה התראה לקוראים, המפעילים מקבלים על כך הודעה למכשיר שלהם.\n'
   'על מה זה משפיע: כמה מהר תדעו שמהדורה לא יצאה. ערך קטן מדי יתריע על מהדורה שפשוט מאחרת; ערך גדול מדי מאחר את הגילוי.\n'
   'איפה זה ממומש: שרת: public.app_missed_editions ו-public.app_edition_watchdog (מיגרציה 0037).\n'
   'פורמט: מספר שלם של דקות, בין 5 ל-180.',
   'מערכת', 'int', '{"min": 5, "max": 180}'::jsonb, '30'::jsonb, false, false, 5047),
  ('edition_alerts_enabled', 'true'::jsonb, 'התרעה למפעילים כשמהדורה לא הגיעה',
   E'מה זה: מתג ראשי להתרעות על מהדורה חסרה. כבוי — לא נשלחות התרעות בכלל.\n'
   'על מה זה משפיע: רק על ההתרעות למפעילים. הקליטה, הכתיבה וההתראות לקוראים לא תלויות בו.\n'
   'איפה זה ממומש: שרת: public.app_edition_watchdog (מיגרציה 0037).\n'
   'פורמט: true או false.',
   'מערכת', 'bool', '{}'::jsonb, 'true'::jsonb, false, false, 5048)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- The Hebrew editions the service owes on a given day, and when each is due (Israel time). Reads the same schedule
-- app_next_edition reads: the day's kind (weekday / chol hamoed), the times per slot, the daily edition, and the
-- Motzei Shabbat edition after a rest period ends. A slot that falls inside a rest period is not expected at all.
create or replace function public.app_expected_editions(p_day date)
returns table (slot text, due_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_sched jsonb := public.app_setting_json('edition_schedule');
  v_times jsonb := coalesce(v_sched -> 'times', '{}'::jsonb);
  v_days  jsonb := coalesce(v_sched -> 'days', '{}'::jsonb);
  v_lead interval := make_interval(mins => coalesce((v_sched ->> 'erev_lead_min')::int, 60));
  v_after_rest interval := make_interval(mins => coalesce((v_sched ->> 'motzash_after_min')::int, 60));
  v_not_before time := coalesce(v_sched ->> 'motzash_not_before', '21:00')::time;
  v_kind text := coalesce((select c.kind from public.app_calendar_days c where c.day = p_day), 'weekday');
  v_slots text[];
  v_slot text;
  v_at timestamptz;
  v_motzash boolean := exists (select 1 from public.app_rest_periods rp
                               where rp.city_id = 'jerusalem'
                                 and (rp.ends_at at time zone 'Asia/Jerusalem')::date = p_day);
  r record;
begin
  select coalesce(array_agg(x.v), array['morning', 'noon', 'evening'])
    into v_slots from jsonb_array_elements_text(coalesce(v_days -> v_kind, v_days -> 'weekday')) as x(v);
  foreach v_slot in array v_slots loop
    -- a night that follows Shabbat or a Yom Tov: the Motzei Shabbat edition is the evening edition. In winter the
    -- service sends the regular one after it as well, but one of the two is all we are owed.
    continue when v_motzash and v_slot in ('evening', 'daily');
    v_at := (p_day + coalesce(v_times ->> v_slot, '21:00')::time) at time zone 'Asia/Jerusalem';
    continue when exists (select 1 from public.app_rest_periods rp
                          where rp.city_id = 'jerusalem' and v_at >= rp.starts_at - v_lead and v_at < rp.ends_at);
    slot := v_slot; due_at := v_at; return next;
  end loop;
  -- the daily edition (on a Motzei Shabbat night it is the Motzei Shabbat edition, below)
  v_at := (p_day + coalesce(v_times ->> 'daily', v_sched ->> 'daily_time', '21:00')::time) at time zone 'Asia/Jerusalem';
  if v_motzash then
    v_at := null;
  end if;
  if public.app_rest_starts_on(p_day) then
    v_at := (p_day + coalesce(v_times ->> 'noon', '15:00')::time) at time zone 'Asia/Jerusalem';
  end if;
  if v_at is not null
     and not exists (select 1 from public.app_rest_periods rp
                     where rp.city_id = 'jerusalem' and v_at >= rp.starts_at - v_lead and v_at < rp.ends_at) then
    slot := 'daily'; due_at := v_at; return next;
  end if;
  -- Motzei Shabbat / Motzei Chag: an hour after the rest period ends, and not before motzash_not_before
  for r in select rp.ends_at from public.app_rest_periods rp
           where rp.city_id = 'jerusalem' and (rp.ends_at at time zone 'Asia/Jerusalem')::date = p_day loop
    slot := 'motzash';
    due_at := greatest(r.ends_at + v_after_rest, (p_day + v_not_before) at time zone 'Asia/Jerusalem');
    return next;
  end loop;
end;
$$;

-- What the service owed today and has not delivered: an edition that was never written, or one written without a
-- notification going to the readers it belongs to. Only slots whose grace period has passed are reported.
create or replace function public.app_missed_editions(p_day date default null)
returns table (slot text, due_at timestamptz, reason text)
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(p_day, (now() at time zone 'Asia/Jerusalem')::date) as day),
  grace as (select make_interval(mins => least(greatest(public.app_setting_int('edition_alert_grace_minutes', 30), 5), 180)) as g),
  due as (select e.slot, e.due_at from d, grace, public.app_expected_editions(d.day) e
          where e.due_at + grace.g <= now()),
  wrote as (
    select t.id, public.app_edition_slot_key(t.edition_type, t.time_slot, public.app_edition_title(t.main_text)) as k
    from d join public.tamzit_editions t on t.edition_date = d.day
    where t.language = 'hebrew' and t.edition_type <> 'special_update')
  select due.slot, due.due_at,
         case when not exists (select 1 from wrote w where w.k = due.slot) then 'missing' else 'not_pushed' end
  from due
  where not exists (select 1 from wrote w where w.k = due.slot)
     or not exists (select 1 from public.app_push_log l
                    where l.edition_id in (select w.id from wrote w where w.k = due.slot));
$$;

-- The slot's name as a person says it.
create or replace function public.app_slot_name_he(p_slot text) returns text
language sql immutable set search_path = public as $$
  select case p_slot
    when 'morning' then 'מהדורת הבוקר' when 'noon' then 'מהדורת הצהריים'
    when 'evening' then 'מהדורת הערב' when 'daily' then 'המהדורה היומית'
    when 'motzash' then 'מהדורת מוצאי שבת' else p_slot end;
$$;

-- Points the app-watch job at the next slot worth checking (its due time plus the grace period), or removes it.
create or replace function public.app_watch_reschedule() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_next timestamptz;
  v_grace interval := make_interval(mins => least(greatest(public.app_setting_int('edition_alert_grace_minutes', 30), 5), 180));
begin
  if not public.app_setting_bool('edition_alerts_enabled', true) then
    if exists (select 1 from cron.job where jobname = 'app-watch') then
      perform cron.unschedule('app-watch');
    end if;
    return;
  end if;
  select min(e.due_at + v_grace) into v_next
  from (select * from public.app_expected_editions((now() at time zone 'Asia/Jerusalem')::date)
        union all
        select * from public.app_expected_editions(((now() at time zone 'Asia/Jerusalem')::date) + 1)) e
  where e.due_at + v_grace > now();
  if v_next is null then
    if exists (select 1 from cron.job where jobname = 'app-watch') then
      perform cron.unschedule('app-watch');
    end if;
    return;
  end if;
  v_next := date_trunc('minute', v_next) + interval '1 minute';
  perform cron.schedule('app-watch', to_char(v_next at time zone 'UTC', 'MI HH24 DD MM') || ' *',
                        'select public.app_edition_watchdog()');
exception when others then
  raise warning 'app_watch_reschedule: %', sqlerrm;
end;
$$;

-- Tells the operators about an edition that did not arrive, once per slot per day, and sets the next check.
create or replace function public.app_edition_watchdog() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'Asia/Jerusalem')::date;
  v_new int := 0;
  v_lines text := '';
  r record;
  v_url text;
begin
  if not public.app_setting_bool('edition_alerts_enabled', true) then
    perform public.app_watch_reschedule();
    return 0;
  end if;
  for r in select * from public.app_missed_editions(v_day) loop
    insert into public.app_edition_alerts (day, slot, due_at, reason)
    values (v_day, r.slot, r.due_at, r.reason)
    on conflict (day, slot) do nothing;
    if found then
      v_new := v_new + 1;
      v_lines := v_lines || case when v_lines = '' then '' else ', ' end
                 || public.app_slot_name_he(r.slot)
                 || ' (' || to_char(r.due_at at time zone 'Asia/Jerusalem', 'HH24:MI')
                 || case when r.reason = 'not_pushed' then ', נרשמה בלי התראה' else '' end || ')';
    end if;
  end loop;
  if v_new > 0 then
    v_url := public.app_setting_text('functions_base_url');
    if v_url is not null then
      perform net.http_post(
        url := rtrim(v_url, '/') || '/app-push',
        body := jsonb_build_object('action', 'alert', 'title', 'מהדורה לא יצאה',
                                   'body', v_lines || '. בדקו את חדר העריכה ואת הקליטה מוואטסאפ.'),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-app-secret', coalesce(public.app_setting_text('push_webhook_secret'), '')),
        timeout_milliseconds := 30000);
    end if;
  end if;
  perform public.app_watch_reschedule();
  return v_new;
exception when others then
  raise warning 'app_edition_watchdog: %', sqlerrm;
  return 0;
end;
$$;

-- The operators' own devices: where an alert goes.
create or replace function public.app_operator_tokens()
returns table (push_token text)
language sql stable security definer set search_path = public as $$
  select d.push_token from public.app_devices d
  where d.push_token is not null and public.app_is_console_admin(d.profile_id);
$$;

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
  perform public.app_whapi_watchdog();
  perform public.app_edition_watchdog();
  delete from public.app_events
  where created_at < now() - make_interval(days => least(greatest(public.app_setting_int('events_keep_days', 180), 7), 730));
  delete from public.app_edition_alerts where day < (now() at time zone 'Asia/Jerusalem')::date - 30;
end;
$$;

revoke execute on function public.app_expected_editions(date) from public, anon, authenticated;
revoke execute on function public.app_missed_editions(date) from public, anon, authenticated;
revoke execute on function public.app_edition_watchdog() from public, anon, authenticated;
revoke execute on function public.app_watch_reschedule() from public, anon, authenticated;
revoke execute on function public.app_operator_tokens() from public, anon, authenticated;
grant execute on function public.app_expected_editions(date) to service_role;
grant execute on function public.app_missed_editions(date) to service_role;
grant execute on function public.app_edition_watchdog() to service_role;
grant execute on function public.app_watch_reschedule() to service_role;
grant execute on function public.app_operator_tokens() to service_role;

select public.app_watch_reschedule();
