-- Tamzit app: the hourly check makes sure Whapi still calls us.
--
-- What went wrong on 4.10.2026: the noon edition went out on WhatsApp at 15:04 and never reached the app — no
-- edition, no notification. The engine had not logged it (the very case the WhatsApp fallback exists for), and the
-- fallback heard nothing either: our webhook had disappeared from the number's settings in Whapi. Several services
-- share that number, and a service that writes the whole webhook list wipes whatever it does not know about. From
-- 2.10 until then, every WhatsApp message was invisible to us.
--
-- The hourly housekeeping now calls app-whapi's `connect`, which is idempotent: it adds our webhook back only when
-- it is missing, and keeps the other services' webhooks as they are. A wipe now costs at most one hour of blindness
-- instead of staying unnoticed.
-- Idempotent.

create or replace function public.app_whapi_watchdog() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := public.app_setting_text('functions_base_url');
begin
  if v_url is null or not public.app_setting_bool('whatsapp_editions_fallback', true) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/app-whapi',
    body := '{"action":"connect"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-app-secret', coalesce(public.app_setting_text('push_webhook_secret'), '')),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'app_whapi_watchdog: %', sqlerrm;
end;
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
  delete from public.app_events
  where created_at < now() - make_interval(days => least(greatest(public.app_setting_int('events_keep_days', 180), 7), 730));
end;
$$;

revoke execute on function public.app_whapi_watchdog() from public, anon, authenticated;
grant execute on function public.app_whapi_watchdog() to service_role;
