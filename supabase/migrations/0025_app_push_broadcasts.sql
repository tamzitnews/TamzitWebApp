-- Tamzit app: a message the operator sends to the readers' devices (app-push, action "broadcast").
--
-- Until now a push was only sent by the engine's editions and special updates. The operator now has a console
-- (a private web page) that sends one message to every device, or to the devices of one language: a new version,
-- a service notice, an apology for a delay. Every send is written to app_push_broadcasts, so there is a history of
-- what went out, to how many devices and with what result.
--
-- The console never holds the full app secret: it authenticates with app_settings.push_console_secret, which only
-- the console actions of app-push accept (audience, broadcast, history, test). Pushing an edition still needs
-- push_webhook_secret. Idempotent.

create table if not exists public.app_push_broadcasts (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  title       text not null,
  body        text not null,
  url         text,                                -- shown in the message; tapping opens the app
  language    text,                                -- null = every language
  devices     int not null default 0,              -- devices the message was meant for
  sent        int not null default 0,              -- devices the push service accepted
  result      jsonb                                -- counts per outcome (fcm_ok, fcm_invalid, skipped_shabbat …)
);
alter table public.app_push_broadcasts enable row level security;
revoke all on public.app_push_broadcasts from anon, authenticated;

create index if not exists app_push_broadcasts_created_idx on public.app_push_broadcasts (created_at desc);

-- The console's secret: lets it read the audience and send a message, nothing else.
insert into public.app_settings (key, value)
values ('push_console_secret', to_jsonb(encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;
update public.app_settings set
  title = 'סוד הקונסולה לשליחת הודעות',
  description = E'מה זה: סוד שמאפשר לשלוח הודעה לכל המכשירים דרך הקונסולה (הדף שבו כותבים הודעה ושולחים). הוא מאפשר רק את זה: לראות כמה מכשירים רשומים, לשלוח הודעה ולראות היסטוריה. הוא לא מאפשר שום פעולת ניהול אחרת.\n'
    'על מה זה משפיע: מי יכול לשלוח הודעות לקוראים. מי שמקבל אותו יכול לשלוח הודעה לכל המכשירים, אז לא לשתף אותו ולא להכניס אותו לדף ציבורי. כדי לבטל גישה, מחליפים אותו בערך אקראי חדש.\n'
    'איפה זה ממומש: שרת: supabase/functions/app-push/index.ts (פעולות audience, broadcast, history, test).\n'
    'פורמט: טקסט בתוך מירכאות כפולות.',
  category = 'מערכת', value_type = 'text', constraints = '{}'::jsonb, default_value = null,
  is_public = false, is_secret = true, sort = 5050
where key = 'push_console_secret';

-- Writes one broadcast to the history. Returns its id.
create or replace function public.app_log_broadcast(
  p_title text, p_body text, p_url text, p_language text, p_devices int, p_sent int, p_result jsonb
) returns bigint
language sql security definer set search_path = public as $$
  insert into public.app_push_broadcasts (title, body, url, language, devices, sent, result)
  values (btrim(coalesce(p_title, '')), btrim(coalesce(p_body, '')), nullif(btrim(coalesce(p_url, '')), ''),
          nullif(btrim(coalesce(p_language, '')), ''), coalesce(p_devices, 0), coalesce(p_sent, 0), p_result)
  returning id;
$$;

revoke execute on function public.app_log_broadcast(text, text, text, text, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.app_log_broadcast(text, text, text, text, int, int, jsonb) to service_role;
