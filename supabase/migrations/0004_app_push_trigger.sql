-- Tamzit app: push plumbing. pg_net (net.http_post, asynchronous: sent after the transaction commits) and
-- the shared secret for the app-push-special edge function. The trigger itself is app_tamzit_editions_push on
-- tamzit_editions (0009); the first version's trigger on app_editions was dropped in 0008.
-- The target URL and the shared secret live in private app_settings keys (not readable by clients):
--   functions_base_url   e.g. "https://<ref>.supabase.co/functions/v1"   (set by supabase/scripts/setup.sh)
--   push_webhook_secret  random, generated below; app-push-special checks it in the x-app-secret header
-- Idempotent.

create extension if not exists pg_net;

insert into public.app_settings (key, value)
values ('push_webhook_secret', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;
