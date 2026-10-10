-- Tamzit app: a parked edition is written the minute it is due, not up to an hour later.
--
-- What went wrong on motzash, 10.10: "מהדורת מוצאי שבת א" went out on WhatsApp at 19:37 and the engine did not log
-- it (it logs the ordinary motzash edition every week; the split "א" edition it has never logged). The fallback
-- parked it, and the row became due at 19:57 — and then nothing wrote it. Due rows are handled on the next WhatsApp
-- message or by the hourly check (minute 7), so a quiet twenty minutes after the send meant the edition, and its
-- notification, waited for 20:07. The twenty-minute wait for the engine is by design; the hour after it was not.
--
-- A single cron job, app-due, is now pointed at the earliest row still waiting and fires on that minute; when
-- nothing is waiting it is removed. The job exists only while an edition is parked, so nothing new polls.
--
-- app_ingest_due_editions is as 0035 (app_whapi_pending's two editions of a motzash night) left it, with the one
-- call that re-points the job after a round.
-- Idempotent.

-- Points the app-due job at the earliest edition still waiting, or removes it when none is.
create or replace function public.app_due_reschedule() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_next timestamptz;
begin
  select min(due_at) into v_next from public.app_whapi_pending where done_at is null;
  if v_next is null then
    if exists (select 1 from cron.job where jobname = 'app-due') then
      perform cron.unschedule('app-due');
    end if;
    return;
  end if;
  -- the minute after it is due: cron fires at the start of a minute, and never before the wait is over
  v_next := date_trunc('minute', greatest(v_next, now())) + interval '1 minute';
  perform cron.schedule('app-due', to_char(v_next at time zone 'UTC', 'MI HH24 DD MM') || ' *',
                        'select public.app_ingest_due_editions()');
exception when others then
  raise warning 'app_due_reschedule: %', sqlerrm;      -- never fails the ingest that called it
end;
$$;

-- A regular edition seen on WhatsApp: parked, and the due job pointed at it.
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
  if v_id is not null then
    perform public.app_due_reschedule();
  end if;
  return v_id;
end;
$$;

-- From 0035; only the last line is new: after a round, point the due job at whatever is still waiting.
create or replace function public.app_ingest_due_editions() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id bigint;
  v_n int := 0;
  v_key text;
begin
  for r in
    select * from public.app_whapi_pending
    where done_at is null and due_at <= now()
    order by sent_at
    limit 20
    for update skip locked
  loop
    v_key := public.app_edition_slot_key(r.edition_type, r.time_slot, public.app_edition_title(r.main_text));
    -- the engine (or an earlier pending row) wrote this edition in the meantime: nothing to do
    if exists (select 1 from public.tamzit_editions e
               where e.language = r.language and e.edition_type = r.edition_type and e.edition_date = r.edition_date
                 and public.app_edition_slot_key(e.edition_type, e.time_slot, public.app_edition_title(e.main_text))
                     = v_key) then
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
    if r.ad_text is not null and public.app_ad_element_for_caption(r.ad_text, coalesce(r.ad_at, r.sent_at)) is null then
      insert into public.tamzit_edition_elements (created_at, edition_id, element_type, content_text, position)
      values (coalesce(r.ad_at, r.sent_at), v_id, 'ad', r.ad_text, 0);
    end if;
    update public.app_whapi_pending set done_at = now(), outcome = 'written', edition_id = v_id where id = r.id;
    v_n := v_n + 1;
  end loop;
  perform public.app_due_reschedule();          -- the next one waiting, or no job at all
  return v_n;
end;
$$;

revoke execute on function public.app_due_reschedule() from public, anon, authenticated;
grant execute on function public.app_due_reschedule() to service_role;

select public.app_due_reschedule();
