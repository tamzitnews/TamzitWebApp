-- Test groups: what the service's numbers send to them is a test (the Editing Room's test mode sends whole editions
-- there), so app-whapi does not write it as an edition, an ad or a special update, and nothing is pushed.
-- On 2.10.2026 a test send of the Editing Room's morning edition was written as edition 2225 and pushed.
insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('whapi_test_chat_ids',
   '["120363406442049351@g.us", "120363408883899566@g.us", "120363407047238214@g.us"]'::jsonb,
   'קבוצות בדיקה בוואטסאפ',
   E'מה זה: מזהי קבוצות הוואטסאפ של הבדיקות (למשל "120363406442049351@g.us"). מה שהמספרים של השירות שולחים לקבוצה כזו הוא בדיקה, ולא נכנס לאפליקציה.\n'
   'על מה זה משפיע: הודעה לקבוצת בדיקה לא נכתבת כמהדורה, כפרסומת או כעדכון מיוחד, ולא שולחת התראה. מצב הבדיקה של חדר העריכה שולח מהדורות שלמות לקבוצות האלה.\n'
   'איפה זה ממומש: שרת: supabase/functions/_shared/whapi.ts (handleSent, testChats) ו-supabase/functions/app-whapi/index.ts.\n'
   'פורמט: רשימה בסוגריים מרובעים של מזהים במירכאות כפולות. דוגמה: ["120363406442049351@g.us"].',
   'מערכת', 'text_list', '{"max_items": 50}'::jsonb, '[]'::jsonb, false, false, 5031)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;
