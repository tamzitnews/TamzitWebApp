-- Tamzit app: call the app-push-special edge function when a special edition is published.
-- Uses pg_net (net.http_post, asynchronous; the request is sent after the transaction commits).
-- The target URL and the shared secret live in private app_settings keys (not readable by clients):
--   functions_base_url   e.g. "https://<ref>.supabase.co/functions/v1"   (set by supabase/scripts/setup.sh)
--   push_webhook_secret  random, generated below; app-push-special checks it in the x-app-secret header
-- Idempotent.

create extension if not exists pg_net;

insert into public.app_settings (key, value)
values ('push_webhook_secret', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

create or replace function public.app_editions_notify_special()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := public.app_setting_text('functions_base_url');
  v_secret text := public.app_setting_text('push_webhook_secret');
begin
  if new.edition_type <> 'special' or new.status <> 'published' or new.pushed_at is not null then
    return new;
  end if;
  -- only on the transition to published (insert as published, or draft -> published)
  if tg_op = 'UPDATE' and old.status = 'published' and old.edition_type = 'special' then
    return new;
  end if;
  if v_url is null then
    raise log 'app_editions_notify_special: functions_base_url is not set; no push for edition %', new.id;
    return new;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/app-push-special',
    body := jsonb_build_object('edition_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-app-secret', coalesce(v_secret, '')),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;

revoke execute on function public.app_editions_notify_special() from public, anon, authenticated;

drop trigger if exists app_editions_push_special on public.app_editions;
create trigger app_editions_push_special
  after insert or update of status, edition_type on public.app_editions
  for each row execute function public.app_editions_notify_special();
