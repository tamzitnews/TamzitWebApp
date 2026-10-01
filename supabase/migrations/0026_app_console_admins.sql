-- Tamzit app: who may open the message console and send a message to the readers.
--
-- The console (GET /functions/v1/app-console) is a page the operator opens in a browser. Signing in works exactly as
-- in the app: a phone number, then the six-digit code that arrives by email. The account's email must be listed in
-- app_settings.console_admin_emails; anyone else is refused, even with a valid login. An empty list locks everyone
-- out, which is also how the console is turned off.
--
-- To add an operator (the address their login code arrives at):
--   update public.app_settings
--      set value = (value || to_jsonb(array['someone@example.org']))
--    where key = 'console_admin_emails';
-- Removing an address takes effect at once: the console checks on every call. Idempotent.

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('console_admin_emails', '[]'::jsonb, 'מי יכול לשלוח הודעות לקוראים',
   E'מה זה: כתובות הדוא"ל של מי שרשאי להיכנס לקונסולת ההודעות (הדף שבו כותבים הודעה לקוראים ושולחים אותה). הכניסה היא עם מספר טלפון וקוד שנשלח לדוא"ל, בדיוק כמו באפליקציה, והכתובת של החשבון חייבת להופיע כאן. רשימה ריקה: אף אחד לא יכול להיכנס, וזו גם הדרך לכבות את הקונסולה.\n'
   'על מה זה משפיע: מי יכול לשלוח התראה לכל המכשירים. הסרת כתובת חוסמת אותה מיד.\n'
   'איפה זה ממומש: שרת: public.app_is_console_admin (מיגרציה 0026), supabase/functions/app-console ו-supabase/functions/app-push (פעולות audience, broadcast, history).\n'
   'פורמט: רשימה בסוגריים מרובעים של כתובות במירכאות כפולות. דוגמה: ["dani@example.org", "noa@example.org"].',
   'מערכת', 'text_list', '{"max_items": 20}'::jsonb, '[]'::jsonb, false, false, 5060)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- The phones setting of an earlier version of this migration, replaced by the emails above.
delete from public.app_settings where key = 'console_admin_phones';

-- May this signed-in account use the console? Its login address must be in the list (case and spaces ignored).
create or replace function public.app_is_console_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from auth.users u,
         unnest(public.app_setting_texts('console_admin_emails', '{}')) as allowed
    where u.id = p_user
      and coalesce(u.email, '') <> ''
      and lower(btrim(u.email)) = lower(btrim(allowed))
  );
$$;

revoke execute on function public.app_is_console_admin(uuid) from public, anon, authenticated;
grant execute on function public.app_is_console_admin(uuid) to service_role;
