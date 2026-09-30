-- Tamzit app: app_settings becomes the catalog of the service's parameters.
--
-- Every row now explains itself: title (Hebrew), description ("מה זה / על מה זה משפיע / איפה זה ממומש / פורמט"),
-- category, value_type + constraints (checked on every insert and update, so a wrong value is refused instead of
-- breaking the feed), default_value (the value the code falls back to), is_public (readable by the app) and
-- is_secret (never readable by clients). Edit the value column in the Supabase table editor; a change applies
-- within a minute on the server and within an hour in the app (it caches the public settings).
--
-- The constants that were written in the SQL functions and edge functions are read from here now (see the catalog
-- below: every row says where it is used). The readers fall back to the default when a row is missing.
-- The public rows are selected by is_public (the policy no longer lists keys).
-- Idempotent: a re-run updates the explanations and rules but never a value.

alter table public.app_settings
  add column if not exists title          text,
  add column if not exists description    text,
  add column if not exists category       text,
  add column if not exists value_type     text,            -- int | number | bool | text | url | email | time | text_list | int_list | json
  add column if not exists constraints    jsonb not null default '{}'::jsonb,  -- min, max, max_length, pattern, options, min_items, max_items
  add column if not exists default_value  jsonb,
  add column if not exists is_public      boolean not null default false,
  add column if not exists is_secret      boolean not null default false,
  add column if not exists sort           int not null default 0,
  add column if not exists updated_at     timestamptz not null default now();

comment on table public.app_settings is 'פרמטרים של השירות. לכל שורה יש הסבר בעמודה description. משנים רק את value.';
comment on column public.app_settings.value is 'הערך (JSON). הפורמט מוסבר בשורה האחרונה של description.';
comment on column public.app_settings.description is 'מה זה, על מה זה משפיע, איפה זה ממומש, ובאיזה פורמט כותבים את הערך.';
comment on column public.app_settings.default_value is 'הערך שהקוד משתמש בו אם השורה חסרה. להשוואה ולשחזור.';
comment on column public.app_settings.is_public is 'true: האפליקציה קוראת את הערך (בלי התחברות). אסור לסודות.';

-- ---------------------------------------------------------------------------
-- Validation: a value that does not fit its type / rules is refused, with a Hebrew message.
-- ---------------------------------------------------------------------------
create or replace function public.app_settings_check() returns trigger
language plpgsql set search_path = public as $$
declare
  c jsonb := coalesce(new.constraints, '{}'::jsonb);
  t text := jsonb_typeof(new.value);
  v text := new.value #>> '{}';
  n numeric;
  x jsonb;
  k int;
  bad text;
begin
  new.updated_at := now();
  if new.value_type is null then
    return new;
  end if;
  if new.is_public and new.is_secret then
    raise exception using errcode = '22023', message = format('ההגדרה %s מסומנת גם כציבורית וגם כסוד', new.key);
  end if;
  -- a parameter without a default that nobody has set yet (e.g. functions_base_url before setup.sh)
  if t = 'null' and new.default_value is null then
    return new;
  end if;

  if new.value_type in ('int', 'number') then
    if t <> 'number' then
      bad := 'מספר, בלי מירכאות';
    else
      n := v::numeric;
      if new.value_type = 'int' and n <> trunc(n) then
        bad := 'מספר שלם';
      elsif c ? 'min' and n < (c ->> 'min')::numeric then
        bad := 'מספר שלא קטן מ-' || (c ->> 'min');
      elsif c ? 'max' and n > (c ->> 'max')::numeric then
        bad := 'מספר שלא גדול מ-' || (c ->> 'max');
      end if;
    end if;
  elsif new.value_type = 'bool' then
    if t <> 'boolean' then
      bad := 'true או false, בלי מירכאות';
    end if;
  elsif new.value_type in ('text', 'url', 'email', 'time') then
    if t <> 'string' then
      bad := 'טקסט בתוך מירכאות כפולות';
    elsif new.value_type = 'url' and v !~ '^https://[^[:space:]]+$' then
      bad := 'כתובת שמתחילה ב-https://';
    elsif new.value_type = 'email' and v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      bad := 'כתובת מייל';
    elsif new.value_type = 'time' and v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      bad := 'שעה בפורמט HH:MM';
    elsif c ? 'options' and not (c -> 'options') ? v then
      bad := 'אחד מהערכים ' || (c ->> 'options');
    elsif c ? 'max_length' and length(v) > (c ->> 'max_length')::int then
      bad := 'טקסט של עד ' || (c ->> 'max_length') || ' תווים';
    elsif c ? 'pattern' and v !~ (c ->> 'pattern') then
      bad := 'טקסט בפורמט ' || (c ->> 'pattern');
    end if;
  elsif new.value_type in ('text_list', 'int_list') then
    if t <> 'array' then
      bad := 'רשימה בסוגריים מרובעים';
    else
      k := jsonb_array_length(new.value);
      if c ? 'min_items' and k < (c ->> 'min_items')::int then
        bad := 'רשימה עם לפחות ' || (c ->> 'min_items') || ' פריטים';
      elsif c ? 'max_items' and k > (c ->> 'max_items')::int then
        bad := 'רשימה עם עד ' || (c ->> 'max_items') || ' פריטים';
      else
        for x in select e from jsonb_array_elements(new.value) e loop
          if new.value_type = 'text_list' and (jsonb_typeof(x) <> 'string' or btrim(x #>> '{}') = '') then
            bad := 'רשימה של טקסטים לא ריקים במירכאות כפולות';
          elsif new.value_type = 'int_list' and (jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric <> trunc((x #>> '{}')::numeric)
                or (c ? 'min' and (x #>> '{}')::numeric < (c ->> 'min')::numeric)
                or (c ? 'max' and (x #>> '{}')::numeric > (c ->> 'max')::numeric)) then
            bad := 'רשימה של מספרים שלמים' || coalesce(' בין ' || (c ->> 'min') || ' ל-' || (c ->> 'max'), '');
          end if;
          exit when bad is not null;
        end loop;
      end if;
    end if;
  elsif new.value_type = 'json' then
    if t <> 'object' then
      bad := 'אובייקט JSON בסוגריים מסולסלים';
    end if;
  else
    bad := 'סוג מוכר (value_type לא תקין: ' || new.value_type || ')';
  end if;

  if bad is not null then
    raise exception using errcode = '22023',
      message = format('הערך של %s לא תקין: צריך להיות %s. התקבל: %s', new.key, bad, left(new.value::text, 200));
  end if;
  return new;
end;
$$;

drop trigger if exists app_settings_check on public.app_settings;
create trigger app_settings_check before insert or update on public.app_settings
  for each row execute function public.app_settings_check();

-- The app reads the public, non-secret rows (the policy listed four keys until now).
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to anon, authenticated
  using (is_public and not is_secret);

-- ---------------------------------------------------------------------------
-- Readers (server side). Each falls back to p_default when the row is missing or has another type.
-- ---------------------------------------------------------------------------
create or replace function public.app_setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case jsonb_typeof(s.value)
                            when 'number' then round((s.value #>> '{}')::numeric)::int
                            when 'string' then case when s.value #>> '{}' ~ '^-?[0-9]{1,9}$' then (s.value #>> '{}')::int end
                          end
                   from public.app_settings s where s.key = p_key), p_default);
$$;

create or replace function public.app_setting_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric end
                   from public.app_settings s where s.key = p_key), p_default);
$$;

create or replace function public.app_setting_bool(p_key text, p_default boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(s.value) = 'boolean' then (s.value #>> '{}')::boolean end
                   from public.app_settings s where s.key = p_key), p_default);
$$;

-- A list of non-empty texts (or p_default when missing / empty).
create or replace function public.app_setting_texts(p_key text, p_default text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(array(select btrim(e) from jsonb_array_elements_text(s.value) e where btrim(e) <> ''), '{}')
     from public.app_settings s where s.key = p_key and jsonb_typeof(s.value) = 'array'),
    p_default);
$$;

-- '(w1|w2|…)' matching any of the words literally (regex characters escaped).
create or replace function public.app_regex_any(p_words text[]) returns text
language sql immutable set search_path = public as $$
  select '(' || string_agg(regexp_replace(w, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '|') || ')'
  from unnest(p_words) w where w <> '';
$$;

-- ===========================================================================
-- The catalog: one row per parameter. Values are inserted only when the key is new; a re-run updates the
-- explanations and rules but never the value someone set.
-- ===========================================================================

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('edition_schedule', '{"times": {"morning": "09:00", "noon": "15:00", "evening": "21:00"}, "days": {"weekday": ["morning", "noon", "evening"], "chol_hamoed": ["morning", "evening"]}, "erev_lead_min": 60, "motzash_after_min": 60, "motzash_not_before": "21:00", "languages": {"en": {"times": {"morning": "09:30", "noon": "15:30", "evening": "21:45"}}, "fr": {"times": {"morning": "09:30", "noon": "15:30", "evening": "21:45", "daily": "19:30"}}}, "daily_time": "21:00"}'::jsonb, 'לוח המהדורות של השירות', 'מה זה: השעות שבהן יוצאות המהדורות וסוגי הימים. שדות: times – שעת כל מהדורה (morning בוקר, noon צהריים, evening ערב), בפורמט "HH:MM"; days – אילו מהדורות יוצאות בכל סוג יום (weekday יום חול, chol_hamoed חול המועד; סוגי הימים עצמם בטבלה app_calendar_days); erev_lead_min – מהדורה שמתוכננת פחות מכך דקות לפני כניסת שבת או חג לא נחשבת; motzash_after_min – כמה דקות אחרי צאת השבת או החג צפויה מהדורת מוצאי שבת; motzash_not_before – ולא לפני השעה הזו; languages – שעות אחרות לאנגלית (en) ולצרפתית (fr), גוברות על times; daily_time – שעת המהדורה היומית.
על מה זה משפיע: מה שהאפליקציה מציגה תחת "המהדורה הבאה": איזו מהדורה ובערך מתי. ההתראות עצמן לא תלויות בשעות האלה: הן יוצאות כשהמהדורה נשמרת במסד.
איפה זה ממומש: שרת: הפונקציה public.app_next_edition (מיגרציה 0013) קוראת את ההגדרה ב-app_setting_json(''edition_schedule''). האפליקציה מקבלת את התוצאה בשדה next_edition של app_personal_edition ומציגה אותה במסך המהדורה (mobile/src/features/edition/editionMeta.ts, useNextEdition).
פורמט: אובייקט JSON בסוגריים מסולסלים, באותו מבנה כמו ערך ברירת המחדל (default_value).', 'לוח מהדורות', 'json', '{}'::jsonb, '{"times": {"morning": "09:00", "noon": "15:00", "evening": "21:00"}, "days": {"weekday": ["morning", "noon", "evening"], "chol_hamoed": ["morning", "evening"]}, "erev_lead_min": 60, "motzash_after_min": 60, "motzash_not_before": "21:00", "languages": {"en": {"times": {"morning": "09:30", "noon": "15:30", "evening": "21:45"}}, "fr": {"times": {"morning": "09:30", "noon": "15:30", "evening": "21:45", "daily": "19:30"}}}, "daily_time": "21:00"}'::jsonb, false, false, 10),
  ('track_fallback_days', '14'::jsonb, 'ימים בלי מהדורה לפני מעבר למסלול חלופי', 'מה זה: אם בשפה של הקורא לא יצאה אף מהדורה במסלול שלו (נוער, יומית או קלאסית) במשך מספר הימים הזה, הוא מקבל את המסלול החלופי: נוער ויומית עוברים לקלאסית, וקלאסית עוברת ליומית.
על מה זה משפיע: איזו מהדורה מוצגת לקורא באפליקציה, ועל איזו מהדורה הוא מקבל התראה.
איפה זה ממומש: שרת: public.app_reader_track (מיגרציה 0015). משמשת את app_personal_edition, app_next_edition ו-app_push_edition_targets.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-90. דוגמה: 14.', 'לוח מהדורות', 'int', '{"min": 1, "max": 90}'::jsonb, '14'::jsonb, false, false, 20),
  ('push_max_age_minutes', '120'::jsonb, 'גיל מרבי של מהדורה להתראה (דקות)', 'מה זה: מהדורה שזמן היצירה שלה (created_at) ישן יותר ממספר הדקות הזה לא מקפיצה התראה. זה קורה למשל כשמהדורה ישנה נשמרת שוב, או בשליחה חוזרת ידנית.
על מה זה משפיע: מונע התראות על מהדורות ישנות.
איפה זה ממומש: שרת: הטריגר public.app_tamzit_editions_push על הטבלה tamzit_editions (מיגרציה 0015), ופונקציית הקצה supabase/functions/app-push/index.ts, שבודקת שוב לפני השליחה.
פורמט: מספר שלם, בלי מירכאות, בין 10 ל-1440. דוגמה: 120.', 'התראות', 'int', '{"min": 10, "max": 1440}'::jsonb, '120'::jsonb, false, false, 30),
  ('push_headline_max_chars', '140'::jsonb, 'אורך מרבי של הכותרת בהתראה (תווים)', 'מה זה: לקורא שבחר "כותרת בהתראה" נשלחת בגוף ההתראה הכותרת של הידיעה הראשונה במהדורה. אם אין לה כותרת, נשלחת תחילת הטקסט שלה, חתוכה לאורך הזה.
על מה זה משפיע: אורך הטקסט בגוף ההתראה.
איפה זה ממומש: שרת: public.app_push_payload (מיגרציה 0015), שנקראת מ-supabase/functions/app-push/index.ts.
פורמט: מספר שלם, בלי מירכאות, בין 40 ל-300. דוגמה: 140.', 'התראות', 'int', '{"min": 40, "max": 300}'::jsonb, '140'::jsonb, false, false, 40),
  ('push_special_title_he', '"עדכון מיוחד"'::jsonb, 'כותרת התראת עדכון מיוחד (עברית)', 'מה זה: הכותרת של ההתראה שנשלחת כשיוצא עדכון מיוחד (מבזק מחוץ ללוח הזמנים), לקוראים בעברית.
על מה זה משפיע: הטקסט המודגש בהתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts. אם השדה ריק, הפונקציה משתמשת בטקסט הקבוע שבקוד.
פורמט: טקסט בתוך מירכאות כפולות, עד 60 תווים. דוגמה: "עדכון מיוחד".', 'התראות', 'text', '{"max_length": 60}'::jsonb, '"עדכון מיוחד"'::jsonb, false, false, 50),
  ('push_special_title_en', '"Special update"'::jsonb, 'כותרת התראת עדכון מיוחד (אנגלית)', 'מה זה: הכותרת של ההתראה שנשלחת כשיוצא עדכון מיוחד (מבזק מחוץ ללוח הזמנים), לקוראים באנגלית.
על מה זה משפיע: הטקסט המודגש בהתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts. אם השדה ריק, הפונקציה משתמשת בטקסט הקבוע שבקוד.
פורמט: טקסט בתוך מירכאות כפולות, עד 60 תווים. דוגמה: "Special update".', 'התראות', 'text', '{"max_length": 60}'::jsonb, '"Special update"'::jsonb, false, false, 60),
  ('push_special_title_fr', '"Mise à jour spéciale"'::jsonb, 'כותרת התראת עדכון מיוחד (צרפתית)', 'מה זה: הכותרת של ההתראה שנשלחת כשיוצא עדכון מיוחד (מבזק מחוץ ללוח הזמנים), לקוראים בצרפתית.
על מה זה משפיע: הטקסט המודגש בהתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts. אם השדה ריק, הפונקציה משתמשת בטקסט הקבוע שבקוד.
פורמט: טקסט בתוך מירכאות כפולות, עד 60 תווים. דוגמה: "Mise à jour spéciale".', 'התראות', 'text', '{"max_length": 60}'::jsonb, '"Mise à jour spéciale"'::jsonb, false, false, 70),
  ('push_special_body_he', '"יש עדכון חשוב באפליקציה."'::jsonb, 'גוף התראת עדכון מיוחד (עברית)', 'מה זה: גוף ההתראה על עדכון מיוחד, לקוראים בעברית. נשלח לקוראים שלא בחרו "כותרת בהתראה", או כשלעדכון אין כותרת.
על מה זה משפיע: הטקסט שמתחת לכותרת ההתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts.
פורמט: טקסט בתוך מירכאות כפולות, עד 200 תווים. דוגמה: "יש עדכון חשוב באפליקציה.".', 'התראות', 'text', '{"max_length": 200}'::jsonb, '"יש עדכון חשוב באפליקציה."'::jsonb, false, false, 80),
  ('push_special_body_en', '"There is an important update in the app."'::jsonb, 'גוף התראת עדכון מיוחד (אנגלית)', 'מה זה: גוף ההתראה על עדכון מיוחד, לקוראים באנגלית. נשלח לקוראים שלא בחרו "כותרת בהתראה", או כשלעדכון אין כותרת.
על מה זה משפיע: הטקסט שמתחת לכותרת ההתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts.
פורמט: טקסט בתוך מירכאות כפולות, עד 200 תווים. דוגמה: "There is an important update in the app.".', 'התראות', 'text', '{"max_length": 200}'::jsonb, '"There is an important update in the app."'::jsonb, false, false, 90),
  ('push_special_body_fr', '"Une mise à jour importante vous attend dans l’application."'::jsonb, 'גוף התראת עדכון מיוחד (צרפתית)', 'מה זה: גוף ההתראה על עדכון מיוחד, לקוראים בצרפתית. נשלח לקוראים שלא בחרו "כותרת בהתראה", או כשלעדכון אין כותרת.
על מה זה משפיע: הטקסט שמתחת לכותרת ההתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts.
פורמט: טקסט בתוך מירכאות כפולות, עד 200 תווים. דוגמה: "Une mise à jour importante vous attend dans l’application.".', 'התראות', 'text', '{"max_length": 200}'::jsonb, '"Une mise à jour importante vous attend dans l’application."'::jsonb, false, false, 100),
  ('push_edition_body_he', '"כמה דקות, ואתם מעודכנים."'::jsonb, 'גוף התראת מהדורה חדשה (עברית)', 'מה זה: גוף ההתראה כשעולה מהדורה חדשה, לקוראים בעברית. הכותרת היא שם המהדורה (למשל "מהדורת הבוקר מוכנה") ונשארת בקוד. הגוף הזה נשלח לקוראים שלא בחרו "כותרת בהתראה".
על מה זה משפיע: הטקסט שמתחת לכותרת ההתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts.
פורמט: טקסט בתוך מירכאות כפולות, עד 200 תווים. דוגמה: "כמה דקות, ואתם מעודכנים.".', 'התראות', 'text', '{"max_length": 200}'::jsonb, '"כמה דקות, ואתם מעודכנים."'::jsonb, false, false, 110),
  ('push_edition_body_en', '"A few minutes, and you’re up to date."'::jsonb, 'גוף התראת מהדורה חדשה (אנגלית)', 'מה זה: גוף ההתראה כשעולה מהדורה חדשה, לקוראים באנגלית. הכותרת היא שם המהדורה (למשל "מהדורת הבוקר מוכנה") ונשארת בקוד. הגוף הזה נשלח לקוראים שלא בחרו "כותרת בהתראה".
על מה זה משפיע: הטקסט שמתחת לכותרת ההתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts.
פורמט: טקסט בתוך מירכאות כפולות, עד 200 תווים. דוגמה: "A few minutes, and you’re up to date.".', 'התראות', 'text', '{"max_length": 200}'::jsonb, '"A few minutes, and you’re up to date."'::jsonb, false, false, 120),
  ('push_edition_body_fr', '"Quelques minutes, et vous êtes à jour."'::jsonb, 'גוף התראת מהדורה חדשה (צרפתית)', 'מה זה: גוף ההתראה כשעולה מהדורה חדשה, לקוראים בצרפתית. הכותרת היא שם המהדורה (למשל "מהדורת הבוקר מוכנה") ונשארת בקוד. הגוף הזה נשלח לקוראים שלא בחרו "כותרת בהתראה".
על מה זה משפיע: הטקסט שמתחת לכותרת ההתראה.
איפה זה ממומש: שרת: supabase/functions/app-push/index.ts.
פורמט: טקסט בתוך מירכאות כפולות, עד 200 תווים. דוגמה: "Quelques minutes, et vous êtes à jour.".', 'התראות', 'text', '{"max_length": 200}'::jsonb, '"Quelques minutes, et vous êtes à jour."'::jsonb, false, false, 130),
  ('max_items', '10'::jsonb, 'מספר מרבי של ידיעות במהדורה האישית', 'מה זה: כמה ידיעות חדשות מוצגות לכל היותר במהדורה המותאמת אישית, אחרי הסינון לפי הנושאים ורמת החשיבות שהקורא בחר. הספירה לא כוללת עדכונים מיוחדים, ידיעות קהילה ו"ונסיים בטוב". ידיעות קריטיות קודמות לאחרות. מהדורה שנפתחת במלואה (מהארכיון או מהתראה על עדכון מיוחד) לא מוגבלת.
על מה זה משפיע: אורך המהדורה האישית.
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0015). האפליקציה מציגה את מה שהשרת מחזיר.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-50. דוגמה: 10.', 'תוכן המהדורה', 'int', '{"min": 1, "max": 50}'::jsonb, '10'::jsonb, false, false, 140),
  ('reading_words_per_minute', '180'::jsonb, 'מהירות קריאה לחישוב זמן הקריאה (מילים לדקה)', 'מה זה: מספר המילים במהדורה מחולק במספר הזה, והתוצאה מעוגלת למעלה.
על מה זה משפיע: הכיתוב "X דקות קריאה" בראש המהדורה באפליקציה (השדה minutes).
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0015). אפליקציה: כותרת המהדורה (mobile/src/features/edition).
פורמט: מספר שלם, בלי מירכאות, בין 60 ל-400. דוגמה: 180.', 'תוכן המהדורה', 'int', '{"min": 60, "max": 400}'::jsonb, '180'::jsonb, false, false, 150),
  ('community_items_max', '3'::jsonb, 'מספר מרבי של ידיעות לכל קהילה', 'מה זה: כמה ידיעות לכל היותר מוצגות מכל קהילה שהקורא בחר, בחלק "הקהילות שלי" של המהדורה.
על מה זה משפיע: אורך חלק הקהילות. 0 מסתיר אותו.
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0015).
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-20. דוגמה: 3.', 'תוכן המהדורה', 'int', '{"min": 0, "max": 20}'::jsonb, '3'::jsonb, false, false, 160),
  ('good_news_lookback_hours', '48'::jsonb, 'חיפוש "ונסיים בטוב" במהדורות קודמות (שעות)', 'מה זה: אם במהדורה אין מדור "ונסיים בטוב", מציגים את הידיעה הטובה האחרונה מהמהדורות הקודמות של הקורא, אם יצאה בטווח השעות הזה. 0 מבטל את החיפוש.
על מה זה משפיע: אם בסוף המהדורה תופיע ידיעה טובה.
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0015).
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-168. דוגמה: 48.', 'תוכן המהדורה', 'int', '{"min": 0, "max": 168}'::jsonb, '48'::jsonb, false, false, 170),
  ('parser_skip_section_words', '["ערוץ", "וואטסאפ", "whatsapp", "טלגרם", "telegram", "עוקבים", "לשיתוף", "הצטרפו", "קמפיין", "שליחת העדכונים", "התנצלות", "קוראים יקרים", "dear readers", "chers lecteurs", "facebook", "פייסבוק", "בחסות", "שיווקי", "פרסומת", "sponsor", "publicit", "annonce", "promo", ">>"]'::jsonb, 'מילים שמסמנות מדור שלא נכנס לאפליקציה', 'מה זה: כשכותרת של מדור בהודעת הוואטסאפ מכילה אחת מהמילים או הביטויים האלה (בלי הבדל בין אותיות גדולות לקטנות), כל התוכן של המדור מדולג: פרסום, קרדיטים, הזמנה להצטרף לערוץ, "קוראים יקרים" וכדומה. מומלץ להשאיר את "קוראים יקרים": הודעות המערכת לקוראים מוצגות בנפרד, כהודעה קטנה בראש המהדורה, ולא כידיעות.
על מה זה משפיע: אילו מדורים מההודעה המקורית נכנסים לאפליקציה.
איפה זה ממומש: שרת: public.app_parse_edition (מיגרציה 0015). זה המפענח שהופך את טקסט הוואטסאפ לידיעות, וכל המהדורות באפליקציה עוברות דרכו.
פורמט: רשימה בסוגריים מרובעים של טקסטים במירכאות כפולות, מופרדים בפסיקים. דוגמה: ["מילה", "ביטוי של כמה מילים"].', 'תוכן המהדורה', 'text_list', '{"min_items": 1, "max_items": 100}'::jsonb, '["ערוץ", "וואטסאפ", "whatsapp", "טלגרם", "telegram", "עוקבים", "לשיתוף", "הצטרפו", "קמפיין", "שליחת העדכונים", "התנצלות", "קוראים יקרים", "dear readers", "chers lecteurs", "facebook", "פייסבוק", "בחסות", "שיווקי", "פרסומת", "sponsor", "publicit", "annonce", "promo", ">>"]'::jsonb, false, false, 180),
  ('parser_good_news_words', '["ונסיים בטוב", "positive note", "good note", "note positive", "bonne note"]'::jsonb, 'מילים שמסמנות את מדור "ונסיים בטוב"', 'מה זה: כותרת מדור שמכילה אחת מהמילים או הביטויים האלה נחשבת למדור הידיעות הטובות, וידיעה ממנו מוצגת בסוף המהדורה תחת "ונסיים בטוב".
על מה זה משפיע: זיהוי הידיעה הטובה.
איפה זה ממומש: שרת: public.app_parse_edition (מיגרציה 0015).
פורמט: רשימה בסוגריים מרובעים של טקסטים במירכאות כפולות, מופרדים בפסיקים. דוגמה: ["מילה", "ביטוי של כמה מילים"].', 'תוכן המהדורה', 'text_list', '{"min_items": 1, "max_items": 30}'::jsonb, '["ונסיים בטוב", "positive note", "good note", "note positive", "bonne note"]'::jsonb, false, false, 190),
  ('ads_for_premium', 'false'::jsonb, 'להציג פרסומות גם למנויי פרימיום', 'מה זה: false: מנויי פרימיום ומשפחתי לא רואים פרסומות. true: כולם רואים.
על מה זה משפיע: הפרסומת שמוצגת אחרי המדור הראשון במהדורה.
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0015). אפליקציה: mobile/src/features/edition/AdSlot.tsx מציגה את השדה ad.
פורמט: true או false, בלי מירכאות.', 'פרסומות ואודיו', 'bool', '{}'::jsonb, 'false'::jsonb, false, false, 200),
  ('ad_label_he', '"פרסומת"'::jsonb, 'תווית פרסומת כברירת מחדל (עברית)', 'מה זה: התווית שמעל פרסומת בעברית כשבהודעת הפרסומת אין שורת תווית משלה (שורה שמתחילה ב-">").
על מה זה משפיע: הכיתוב הקטן שמעל הפרסומת באפליקציה.
איפה זה ממומש: שרת: public.app_ad_json (מיגרציה 0015).
פורמט: טקסט בתוך מירכאות כפולות, עד 80 תווים. דוגמה: "פרסומת".', 'פרסומות ואודיו', 'text', '{"max_length": 80}'::jsonb, '"פרסומת"'::jsonb, false, false, 210),
  ('ad_label_en', '"Sponsored"'::jsonb, 'תווית פרסומת כברירת מחדל (אנגלית)', 'מה זה: התווית שמעל פרסומת באנגלית כשבהודעת הפרסומת אין שורת תווית משלה (שורה שמתחילה ב-">").
על מה זה משפיע: הכיתוב הקטן שמעל הפרסומת באפליקציה.
איפה זה ממומש: שרת: public.app_ad_json (מיגרציה 0015).
פורמט: טקסט בתוך מירכאות כפולות, עד 80 תווים. דוגמה: "Sponsored".', 'פרסומות ואודיו', 'text', '{"max_length": 80}'::jsonb, '"Sponsored"'::jsonb, false, false, 220),
  ('ad_label_fr', '"Publicité"'::jsonb, 'תווית פרסומת כברירת מחדל (צרפתית)', 'מה זה: התווית שמעל פרסומת בצרפתית כשבהודעת הפרסומת אין שורת תווית משלה (שורה שמתחילה ב-">").
על מה זה משפיע: הכיתוב הקטן שמעל הפרסומת באפליקציה.
איפה זה ממומש: שרת: public.app_ad_json (מיגרציה 0015).
פורמט: טקסט בתוך מירכאות כפולות, עד 80 תווים. דוגמה: "Publicité".', 'פרסומות ואודיו', 'text', '{"max_length": 80}'::jsonb, '"Publicité"'::jsonb, false, false, 230),
  ('ad_match_before_min', '2'::jsonb, 'חלון התאמת פרסומת: דקות לפני המהדורה', 'מה זה: פרסומת שהמנוע שמר כרכיב נפרד (טבלה tamzit_edition_elements) משויכת למהדורה אם נשמרה בחלון שמתחיל כך דקות לפני שליחת המהדורה הראשונה ונגמר כמה דקות אחרי השליחה האחרונה (ad_match_after_min). פרסומת שהמנוע קישר ישירות למהדורה משויכת תמיד.
על מה זה משפיע: איזו פרסומת מוצגת במהדורה.
איפה זה ממומש: שרת: public.app_edition_ad (מיגרציה 0015).
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-60. דוגמה: 2.', 'פרסומות ואודיו', 'int', '{"min": 0, "max": 60}'::jsonb, '2'::jsonb, false, false, 240),
  ('ad_match_after_min', '20'::jsonb, 'חלון התאמת פרסומת: דקות אחרי המהדורה', 'מה זה: סוף החלון שבו פרסומת נחשבת שייכת למהדורה: כמה דקות אחרי השליחה האחרונה של המהדורה (ראו ad_match_before_min).
על מה זה משפיע: איזו פרסומת מוצגת במהדורה.
איפה זה ממומש: שרת: public.app_edition_ad (מיגרציה 0015).
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-180. דוגמה: 20.', 'פרסומות ואודיו', 'int', '{"min": 0, "max": 180}'::jsonb, '20'::jsonb, false, false, 250),
  ('audio_match_before_min', '45'::jsonb, 'חלון התאמת קובץ שמע: דקות לפני המהדורה', 'מה זה: קובץ ה-mp3 של המהדורה הקולית נלקח מהדלי news-audio של המנוע. קובץ משויך למהדורה אם נוצר בחלון שמתחיל כך דקות לפני השליחה הראשונה שלה ונגמר audio_match_after_min דקות אחריה.
על מה זה משפיע: איזו הקלטה מתנגנת בנגן של המהדורה.
איפה זה ממומש: שרת: public.app_edition_audio (מיגרציה 0015).
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-180. דוגמה: 45.', 'פרסומות ואודיו', 'int', '{"min": 0, "max": 180}'::jsonb, '45'::jsonb, false, false, 260),
  ('audio_match_after_min', '2'::jsonb, 'חלון התאמת קובץ שמע: דקות אחרי המהדורה', 'מה זה: סוף החלון שבו קובץ שמע נחשב שייך למהדורה: כמה דקות אחרי השליחה הראשונה שלה (ראו audio_match_before_min).
על מה זה משפיע: איזו הקלטה מתנגנת בנגן של המהדורה.
איפה זה ממומש: שרת: public.app_edition_audio (מיגרציה 0015).
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-60. דוגמה: 2.', 'פרסומות ואודיו', 'int', '{"min": 0, "max": 60}'::jsonb, '2'::jsonb, false, false, 270),
  ('audio_chars_per_sec_he', '9.3'::jsonb, 'קצב הקראה בעברית (תווים לשנייה)', 'מה זה: כשכמה קבצי שמע מתאימים לאותו חלון זמן, בוחרים את הקובץ שאורכו הכי קרוב לאורך הטקסט של המהדורה חלקי הקצב הזה.
על מה זה משפיע: בחירת ההקלטה הנכונה כשיש כמה.
איפה זה ממומש: שרת: public.app_edition_audio (מיגרציה 0015).
פורמט: מספר (אפשר עם נקודה עשרונית), בלי מירכאות, בין 3 ל-30. דוגמה: 9.3.', 'פרסומות ואודיו', 'number', '{"min": 3, "max": 30}'::jsonb, '9.3'::jsonb, false, false, 280),
  ('audio_chars_per_sec_other', '13.5'::jsonb, 'קצב הקראה באנגלית ובצרפתית (תווים לשנייה)', 'מה זה: כמו audio_chars_per_sec_he, למהדורות באנגלית ובצרפתית.
על מה זה משפיע: בחירת ההקלטה הנכונה כשיש כמה.
איפה זה ממומש: שרת: public.app_edition_audio (מיגרציה 0015).
פורמט: מספר (אפשר עם נקודה עשרונית), בלי מירכאות, בין 3 ל-30. דוגמה: 13.5.', 'פרסומות ואודיו', 'number', '{"min": 3, "max": 30}'::jsonb, '13.5'::jsonb, false, false, 290),
  ('ad_image_days', '30'::jsonb, 'כמה ימים אחורה מעתיקים תמונות פרסומת (ימים)', 'מה זה: תמונות שצורפו לפרסומות מ-Google Drive, ותמונות התצוגה המקדימה של הקישורים בפרסומות, מועתקות לאחסון של האפליקציה רק לפרסומות מהימים האלה.
על מה זה משפיע: אם לפרסומת ישנה יש תמונה.
איפה זה ממומש: שרת: public.app_media_queue (מיגרציה 0015) ופונקציית הקצה supabase/functions/app-media-sync/index.ts.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-90. דוגמה: 30.', 'פרסומות ואודיו', 'int', '{"min": 1, "max": 90}'::jsonb, '30'::jsonb, false, false, 300),
  ('english_audio_keep_hours', '24'::jsonb, 'כמה זמן נשמר עותק של הקלטה באנגלית (שעות)', 'מה זה: להקלטה באנגלית אין קובץ בדלי news-audio, ולכן מעתיקים אותה מ-Google Drive לאחסון של האפליקציה. העותק נמחק אחרי מספר השעות הזה. המרבי הוא 24, כדי לא למלא את האחסון.
על מה זה משפיע: עד מתי אפשר להאזין למהדורה באנגלית.
איפה זה ממומש: שרת: public.app_media_queue (מיגרציה 0015) ופונקציית הקצה supabase/functions/app-media-sync/index.ts (expireOldAudio).
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-24. דוגמה: 24.', 'פרסומות ואודיו', 'int', '{"min": 1, "max": 24}'::jsonb, '24'::jsonb, false, false, 310),
  ('otp_ttl_min', '10'::jsonb, 'תוקף קוד הכניסה (דקות)', 'מה זה: כמה דקות קוד הכניסה שנשלח במייל תקף.
על מה זה משפיע: התוקף של הקוד, והמשפט "הקוד בתוקף ל-X דקות" במייל.
איפה זה ממומש: שרת: supabase/functions/app-auth-start/index.ts, ונוסח המייל ב-supabase/functions/_shared/app-common.ts (sendCodeEmail).
פורמט: מספר שלם, בלי מירכאות, בין 2 ל-60. דוגמה: 10.', 'כניסה והרשמה', 'int', '{"min": 2, "max": 60}'::jsonb, '10'::jsonb, false, false, 320),
  ('auth_rate_window_min', '15'::jsonb, 'חלון הגבלת ניסיונות (דקות)', 'מה זה: פרק הזמן שבו נספרים ניסיונות שליחת קוד ואימות לאותו מספר טלפון.
על מה זה משפיע: הגנה מפני ניחוש קודים ומפני הצפת מיילים.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (countAttempts), שמשמשת את app-auth-start ו-app-auth-verify.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-1440. דוגמה: 15.', 'כניסה והרשמה', 'int', '{"min": 1, "max": 1440}'::jsonb, '15'::jsonb, false, false, 330),
  ('auth_max_code_sends', '5'::jsonb, 'מספר מרבי של שליחות קוד לטלפון', 'מה זה: כמה פעמים אפשר לבקש קוד כניסה לאותו מספר טלפון בתוך חלון ההגבלה (auth_rate_window_min). מעבר לזה מופיעה הודעה "יותר מדי ניסיונות".
על מה זה משפיע: הגנה מפני הצפת מיילים.
איפה זה ממומש: שרת: supabase/functions/app-auth-start/index.ts.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-50. דוגמה: 5.', 'כניסה והרשמה', 'int', '{"min": 1, "max": 50}'::jsonb, '5'::jsonb, false, false, 340),
  ('auth_max_verifies', '10'::jsonb, 'מספר מרבי של ניסיונות אימות לטלפון', 'מה זה: כמה פעמים אפשר לנסות קוד לאותו מספר טלפון בתוך חלון ההגבלה (auth_rate_window_min).
על מה זה משפיע: הגנה מפני ניחוש קודים.
איפה זה ממומש: שרת: supabase/functions/app-auth-verify/index.ts.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-100. דוגמה: 10.', 'כניסה והרשמה', 'int', '{"min": 1, "max": 100}'::jsonb, '10'::jsonb, false, false, 350),
  ('auth_max_code_attempts', '5'::jsonb, 'ניסיונות שגויים לכל קוד', 'מה זה: אחרי כך ניסיונות שגויים הקוד שנשלח נפסל, וצריך לבקש קוד חדש.
על מה זה משפיע: הגנה מפני ניחוש קודים.
איפה זה ממומש: שרת: supabase/functions/app-auth-verify/index.ts.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-20. דוגמה: 5.', 'כניסה והרשמה', 'int', '{"min": 1, "max": 20}'::jsonb, '5'::jsonb, false, false, 360),
  ('otp_resend_seconds', '60'::jsonb, 'זמן המתנה לשליחת קוד חדש (שניות)', 'מה זה: כמה שניות אחרי שליחת קוד אפשר ללחוץ "שליחה חוזרת" במסך הזנת הקוד.
על מה זה משפיע: הכפתור "שליחה חוזרת" באפליקציה.
איפה זה ממומש: אפליקציה: mobile/src/features/auth/VerifyScreen.tsx (דרך useAppConfig ב-mobile/src/lib/config.ts). האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 10 ל-600. דוגמה: 60.', 'כניסה והרשמה', 'int', '{"min": 10, "max": 600}'::jsonb, '60'::jsonb, true, false, 370),
  ('demo_code', '"123456"'::jsonb, 'קוד הכניסה של חשבונות ההדגמה', 'מה זה: הקוד הקבוע שבו נכנסים לחשבונות ההדגמה (demo_phone, demo_premium_phone, demo_family_phone). לא נשלח מייל, ואין הגבלת ניסיונות. ריק מבטל את כל חשבונות ההדגמה.
על מה זה משפיע: כניסה לבודקי Google Play ו-App Store.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: טקסט בתוך מירכאות כפולות. דוגמה: "123456".', 'חשבונות הדגמה', 'text', '{"pattern": "^([0-9]{6})?$"}'::jsonb, '"123456"'::jsonb, false, false, 380),
  ('demo_phone', '"+972500000000"'::jsonb, 'טלפון חשבון ההדגמה (חינמי)', 'מה זה: מספר הטלפון (בפורמט בינלאומי) של חשבון ההדגמה במסלול חינמי. נכנסים איתו עם demo_code.
על מה זה משפיע: כניסה לבודקי החנויות.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: טקסט בתוך מירכאות כפולות. דוגמה: "+972500000000".', 'חשבונות הדגמה', 'text', '{"pattern": "^\\+[1-9][0-9]{6,14}$"}'::jsonb, '"+972500000000"'::jsonb, false, false, 390),
  ('demo_email', '"demo@tamzit-app.test"'::jsonb, 'מייל חשבון ההדגמה (חינמי)', 'מה זה: כתובת המייל הפנימית של חשבון ההדגמה במסלול חינמי. לא נשלח אליה דואר.
על מה זה משפיע: החשבון שנפתח בכניסה עם הטלפון של ההדגמה.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: כתובת מייל בתוך מירכאות כפולות. דוגמה: "demo@tamzit-app.test".', 'חשבונות הדגמה', 'email', '{}'::jsonb, '"demo@tamzit-app.test"'::jsonb, false, false, 400),
  ('demo_premium_phone', '"+972500000001"'::jsonb, 'טלפון חשבון ההדגמה (פרימיום)', 'מה זה: מספר הטלפון (בפורמט בינלאומי) של חשבון ההדגמה במסלול פרימיום. נכנסים איתו עם demo_code.
על מה זה משפיע: כניסה לבודקי החנויות.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: טקסט בתוך מירכאות כפולות. דוגמה: "+972500000001".', 'חשבונות הדגמה', 'text', '{"pattern": "^\\+[1-9][0-9]{6,14}$"}'::jsonb, '"+972500000001"'::jsonb, false, false, 410),
  ('demo_premium_email', '"demo-premium@tamzit-app.test"'::jsonb, 'מייל חשבון ההדגמה (פרימיום)', 'מה זה: כתובת המייל הפנימית של חשבון ההדגמה במסלול פרימיום. לא נשלח אליה דואר.
על מה זה משפיע: החשבון שנפתח בכניסה עם הטלפון של ההדגמה.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: כתובת מייל בתוך מירכאות כפולות. דוגמה: "demo-premium@tamzit-app.test".', 'חשבונות הדגמה', 'email', '{}'::jsonb, '"demo-premium@tamzit-app.test"'::jsonb, false, false, 420),
  ('demo_family_phone', '"+972500000002"'::jsonb, 'טלפון חשבון ההדגמה (משפחתי)', 'מה זה: מספר הטלפון (בפורמט בינלאומי) של חשבון ההדגמה במסלול משפחתי. נכנסים איתו עם demo_code.
על מה זה משפיע: כניסה לבודקי החנויות.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: טקסט בתוך מירכאות כפולות. דוגמה: "+972500000002".', 'חשבונות הדגמה', 'text', '{"pattern": "^\\+[1-9][0-9]{6,14}$"}'::jsonb, '"+972500000002"'::jsonb, false, false, 430),
  ('demo_family_email', '"demo-family@tamzit-app.test"'::jsonb, 'מייל חשבון ההדגמה (משפחתי)', 'מה זה: כתובת המייל הפנימית של חשבון ההדגמה במסלול משפחתי. לא נשלח אליה דואר.
על מה זה משפיע: החשבון שנפתח בכניסה עם הטלפון של ההדגמה.
איפה זה ממומש: שרת: supabase/functions/_shared/app-common.ts (demoAccount), שמשמשת את app-auth-start ו-app-auth-verify. החשבונות עצמם נוצרים ב-supabase/scripts/setup.sh.
פורמט: כתובת מייל בתוך מירכאות כפולות. דוגמה: "demo-family@tamzit-app.test".', 'חשבונות הדגמה', 'email', '{}'::jsonb, '"demo-family@tamzit-app.test"'::jsonb, false, false, 440),
  ('donation_url', '"https://www.charidy.com/lokchimachrayut/tam"'::jsonb, 'קישור לדף התרומה', 'מה זה: הדף שנפתח כשלוחצים "לתרומה" במסך התרומה.
על מה זה משפיע: לאן התורמים מגיעים.
איפה זה ממומש: אפליקציה: mobile/src/features/premium/DonateScreen.tsx. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: כתובת שמתחילה ב-https://, בתוך מירכאות כפולות. דוגמה: "https://www.charidy.com/lokchimachrayut/tam".', 'קישורים, תרומות ומשפחה', 'url', '{}'::jsonb, '"https://www.charidy.com/lokchimachrayut/tam"'::jsonb, true, false, 450),
  ('support_email', '"support@tamzit.org.il"'::jsonb, 'כתובת התמיכה', 'מה זה: כתובת המייל שמוצגת במסכי "אודות" ו"חשבון", ושאליה נשלחת בקשת מחיקת חשבון.
על מה זה משפיע: יצירת קשר עם המערכת.
איפה זה ממומש: אפליקציה: mobile/src/features/settings/AccountSettings.tsx (useSupportEmail) ומסכי האודות. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: כתובת מייל בתוך מירכאות כפולות. דוגמה: "support@tamzit.org.il".', 'קישורים, תרומות ומשפחה', 'email', '{}'::jsonb, '"support@tamzit.org.il"'::jsonb, true, false, 460),
  ('website_url', '"https://tamzit.org.il"'::jsonb, 'כתובת האתר', 'מה זה: כתובת האתר של תמצית החדשות. מופיעה במסך "אודות", בטקסט השיתוף, בכרטיס השיתוף ובהזמנה למנוי המשפחתי.
על מה זה משפיע: הקישורים לאתר באפליקציה.
איפה זה ממומש: אפליקציה: mobile/src/features/settings/AboutScreens.tsx, mobile/src/features/share/ShareScreen.tsx, mobile/src/features/share/ShareCard.tsx (מציג רק את שם האתר), mobile/src/features/premium/FamilyScreen.tsx והטקסט waText ב-mobile/src/features/premium/strings.ts. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: כתובת שמתחילה ב-https://, בתוך מירכאות כפולות. דוגמה: "https://tamzit.org.il".', 'קישורים, תרומות ומשפחה', 'url', '{}'::jsonb, '"https://tamzit.org.il"'::jsonb, true, false, 470),
  ('privacy_url', '"https://tamzit.org.il/privacy"'::jsonb, 'קישור למדיניות הפרטיות', 'מה זה: הדף שנפתח מ"מדיניות פרטיות" במסך "אודות".
על מה זה משפיע: הקישור למדיניות הפרטיות.
איפה זה ממומש: אפליקציה: mobile/src/features/settings/AboutScreens.tsx. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: כתובת שמתחילה ב-https://, בתוך מירכאות כפולות. דוגמה: "https://tamzit.org.il/privacy".', 'קישורים, תרומות ומשפחה', 'url', '{}'::jsonb, '"https://tamzit.org.il/privacy"'::jsonb, true, false, 480),
  ('donation_amounts', '[18, 36, 100, 180]'::jsonb, 'סכומי התרומה המוצעים (₪)', 'מה זה: הכפתורים של הסכומים המוכנים בכרטיס התרומה, לפי הסדר.
על מה זה משפיע: כרטיס התרומה.
איפה זה ממומש: אפליקציה: mobile/src/features/premium/DonationCard.tsx. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: רשימה בסוגריים מרובעים של מספרים שלמים, עד 6 מספרים. דוגמה: [18, 36, 100, 180].', 'קישורים, תרומות ומשפחה', 'int_list', '{"min_items": 1, "max_items": 6, "min": 1, "max": 1000000}'::jsonb, '[18, 36, 100, 180]'::jsonb, true, false, 490),
  ('donation_default_amount', '36'::jsonb, 'סכום התרומה שנבחר מראש (₪)', 'מה זה: הסכום שמסומן כשכרטיס התרומה נפתח.
על מה זה משפיע: כרטיס התרומה.
איפה זה ממומש: אפליקציה: mobile/src/features/premium/DonationCard.tsx. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-1000000. דוגמה: 36.', 'קישורים, תרומות ומשפחה', 'int', '{"min": 1, "max": 1000000}'::jsonb, '36'::jsonb, true, false, 500),
  ('donation_default_frequency', '"monthly"'::jsonb, 'תדירות התרומה שנבחרת מראש', 'מה זה: monthly: תרומה חודשית. once: תרומה חד-פעמית.
על מה זה משפיע: כרטיס התרומה.
איפה זה ממומש: אפליקציה: mobile/src/features/premium/DonationCard.tsx. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: טקסט בתוך מירכאות כפולות, אחד מ: monthly, once. דוגמה: "monthly".', 'קישורים, תרומות ומשפחה', 'text', '{"options": ["monthly", "once"]}'::jsonb, '"monthly"'::jsonb, true, false, 510),
  ('family_max_members', '4'::jsonb, 'מספר בני המשפחה במנוי משפחתי', 'מה זה: כמה בני משפחה בעל המנוי המשפחתי יכול להוסיף, לא כולל אותו עצמו. 4 פירושו 5 אנשים בסך הכול.
על מה זה משפיע: הגבלת ההזמנות במנוי המשפחתי, והטקסטים שמתארים את המנוי.
איפה זה ממומש: שרת: הטריגר public.app_family_limit על הטבלה app_family_members (מיגרציה 0015) חוסם הזמנה מעבר למספר. אפליקציה: mobile/src/features/premium/FamilyScreen.tsx, PremiumScreen.tsx והטקסטים ב-premium/strings.ts; mobile/src/features/settings/SettingsHome.tsx והטקסט familyCount ב-settings/strings.ts. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-10. דוגמה: 4.', 'קישורים, תרומות ומשפחה', 'int', '{"min": 1, "max": 10}'::jsonb, '4'::jsonb, true, false, 520),
  ('youth_age_range', '"10–15"'::jsonb, 'טווח הגילים של מסלול הנוער', 'מה זה: הגילים שמסלול הנוער מיועד להם, כפי שהם כתובים באפליקציה (למשל 10–15).
על מה זה משפיע: הטקסטים של בחירת המסלול בהרשמה ובהגדרות.
איפה זה ממומש: אפליקציה: mobile/src/features/prefs/pickers.tsx (בחירת המסלול), mobile/src/features/onboarding/steps.tsx (ההרשמה), mobile/src/features/settings/PrefScreens.tsx ו-SettingsHome.tsx (ההגדרות), והטקסטים ב-mobile/src/features/settings/strings.ts. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: טקסט בתוך מירכאות כפולות, עד 20 תווים. דוגמה: "10–15".', 'קישורים, תרומות ומשפחה', 'text', '{"max_length": 20}'::jsonb, '"10–15"'::jsonb, true, false, 530),
  ('free_archive_days', '7'::jsonb, 'ימי ארכיון חינם', 'מה זה: מהדורות מהימים האלה פתוחות לכל הקוראים. מהדורות ישנות יותר נעולות למי שאינו מנוי פרימיום.
על מה זה משפיע: מה פתוח בארכיון, והטקסט שמסביר את זה.
איפה זה ממומש: שרת: public.app_archive ו-public.app_edition_view (מיגרציות 0011, 0012). אפליקציה: mobile/src/features/archive/ArchiveScreen.tsx, mobile/src/features/edition/screens.tsx (מסך מהדורה נעולה), והטקסטים ב-mobile/src/features/archive/strings.ts וב-mobile/src/features/edition/strings.ts. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-3650. דוגמה: 7.', 'אפליקציה', 'int', '{"min": 0, "max": 3650}'::jsonb, '7'::jsonb, true, false, 540),
  ('archive_locked_teaser', '3'::jsonb, 'מספר המהדורות הנעולות שמוצגות בארכיון', 'מה זה: קורא בלי מנוי פרימיום רואה בסוף הארכיון כמה מהדורות נעולות, כדי לדעת שיש עוד. 0 מסתיר אותן.
על מה זה משפיע: תחתית מסך הארכיון.
איפה זה ממומש: אפליקציה: mobile/src/features/archive/ArchiveScreen.tsx. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 0 ל-10. דוגמה: 3.', 'אפליקציה', 'int', '{"min": 0, "max": 10}'::jsonb, '3'::jsonb, true, false, 550),
  ('search_min_chars', '2'::jsonb, 'מספר תווים מינימלי לחיפוש', 'מה זה: החיפוש מתחיל רק כשהוקלדו לפחות כך תווים.
על מה זה משפיע: מסך החיפוש (למנויי פרימיום).
איפה זה ממומש: שרת: public.app_search (מיגרציה 0015). אפליקציה: mobile/src/features/search/useSearch.ts, SearchScreen.tsx והטקסט minChars ב-search/strings.ts. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-10. דוגמה: 2.', 'אפליקציה', 'int', '{"min": 1, "max": 10}'::jsonb, '2'::jsonb, true, false, 560),
  ('edition_refresh_minutes', '5'::jsonb, 'תדירות רענון המהדורה (דקות)', 'מה זה: כל כמה דקות האפליקציה בודקת בשרת אם יש מהדורה חדשה, כשהיא פתוחה על מסך המהדורה. בנוסף היא מתרעננת מיד כשמגיעה התראה.
על מה זה משפיע: כמה מהר מהדורה חדשה מופיעה באפליקציה פתוחה.
איפה זה ממומש: אפליקציה: mobile/src/features/edition/usePersonalEdition.ts. האפליקציה קוראת את הערך דרך useAppConfig (mobile/src/lib/config.ts), ששומרת אותו עד שעה; אם הערך חסר או לא תקין, היא משתמשת בברירת המחדל שבקובץ.
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-60. דוגמה: 5.', 'אפליקציה', 'int', '{"min": 1, "max": 60}'::jsonb, '5'::jsonb, true, false, 570),
  ('functions_base_url', 'null'::jsonb, 'כתובת פונקציות הקצה', 'מה זה: הכתובת שממנה מסד הנתונים קורא לפונקציות הקצה (שליחת התראות, העתקת מדיה). נכתבת על ידי supabase/scripts/setup.sh.
על מה זה משפיע: אם ההתראות והעתקת המדיה עובדות. לא לשנות.
איפה זה ממומש: שרת: הטריגר public.app_tamzit_editions_push ו-public.app_media_kick.
פורמט: כתובת שמתחילה ב-https://, בתוך מירכאות כפולות.', 'מערכת', 'url', '{}'::jsonb, null, false, false, 580),
  ('push_webhook_secret', 'null'::jsonb, 'סוד פנימי לקריאה לפונקציות הקצה', 'מה זה: סוד שמסד הנתונים שולח לפונקציות app-push ו-app-media-sync כדי שרק הוא יוכל להפעיל אותן. נוצר אוטומטית.
על מה זה משפיע: אבטחת הקריאות הפנימיות. לא לשנות ולא לשתף.
איפה זה ממומש: שרת: הטריגר public.app_tamzit_editions_push, public.app_media_kick, supabase/functions/app-push/index.ts, supabase/functions/app-media-sync/index.ts.
פורמט: טקסט בתוך מירכאות כפולות.', 'מערכת', 'text', '{}'::jsonb, null, false, true, 590)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- ===========================================================================
-- The functions that now read their parameters from app_settings (the definitions of 0009–0014, with only
-- the constants replaced).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_reader_track(p_lang text, p_aud text, p_freq integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pref text := case when p_aud = 'youth' then 'teens'
                      when public.app_frequency_of(p_freq) = 1 then 'daily' else 'classic' end;
  v_fallbacks text[] := case v_pref when 'teens' then array['classic', 'daily']
                                    when 'daily' then array['classic'] else array['daily'] end;
  t text;
begin
  foreach t in array array[v_pref] || v_fallbacks loop
    if exists (select 1 from public.tamzit_editions e
               where e.language = public.app_lang_name(p_lang) and public.app_edition_track(e.edition_type) = t
                 and e.created_at > now() - make_interval(days => public.app_setting_int('track_fallback_days', 14))) then
      return t;
    end if;
  end loop;
  return v_pref;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_tamzit_editions_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_url text;
  v_secret text;
  v_key text;
begin
  begin
    if new.created_at < now() - make_interval(mins => public.app_setting_int('push_max_age_minutes', 120)) then
      return new;
    end if;
    if new.edition_type = 'special_update' then
      v_key := 'special:' || coalesce(new.language, '') || ':' || md5(coalesce(new.main_text, ''));
    else
      v_key := 'edition:' || coalesce(new.language, '') || ':' || public.app_edition_track(new.edition_type) || ':'
               || public.app_edition_slot(new.edition_type, new.time_slot) || ':' || coalesce(new.edition_date::text, '');
    end if;
    insert into public.app_push_log (key, edition_id) values (v_key, new.id) on conflict (key) do nothing;
    if not found then
      return new;
    end if;
    v_url := public.app_setting_text('functions_base_url');
    v_secret := public.app_setting_text('push_webhook_secret');
    if v_url is null then
      return new;
    end if;
    perform net.http_post(
      url := rtrim(v_url, '/') || '/app-push',
      body := jsonb_build_object('edition_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-app-secret', coalesce(v_secret, '')),
      timeout_milliseconds := 30000);
  exception when others then
    raise warning 'app_tamzit_editions_push: %', sqlerrm;
  end;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_push_payload(p_edition_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'edition_id', e.id,
    'language', public.app_lang_code(e.language),
    'edition_type', e.edition_type,
    'track', public.app_edition_track(e.edition_type),
    'slot', public.app_edition_slot(e.edition_type, e.time_slot),
    'kind', public.app_edition_kind(e.edition_type, e.time_slot, public.app_edition_title(e.main_text)),
    'edition_date', e.edition_date,
    'created_at', e.created_at,
    'title', public.app_edition_title(e.main_text),
    'headline', (select coalesce(nullif(i.item ->> 'headline', ''), left(i.item ->> 'body', public.app_setting_int('push_headline_max_chars', 140)))
                 from public.app_edition_items(e.id, public.app_lang_code(e.language), 'general', 'informative', null) i
                 order by i.pos limit 1))
  from public.tamzit_editions e where e.id = p_edition_id;
$function$;

CREATE OR REPLACE FUNCTION public.app_build_feed(p_prof user_preferences, p_lang text, p_aud text, p_from timestamp with time zone, p_to timestamp with time zone, p_regular bigint[], p_specials bigint[], p_filter boolean, p_title text, p_types jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := p_prof.user_id;
  v_style text := public.app_style_of(p_prof.persona);
  v_topics text[] := coalesce(p_prof.interests, '{}');
  v_min_rank int := public.app_level_rank(public.app_level_of(p_prof.anxiety_level));
  v_communities text[] := coalesce(p_prof.communities, '{}');
  v_premium boolean := public.app_is_premium(v_uid);
  v_max int := public.app_setting_int('max_items', 10);
  v_items jsonb;
  v_special jsonb;
  v_community jsonb;
  v_good jsonb;
  v_ad jsonb;
  v_audio jsonb;
  v_words int;
  r record;
begin
  with eds as (
    select e.id, e.created_at, dense_rank() over (order by e.created_at desc, e.id desc) as ed_rank
    from public.tamzit_editions e
    where e.id = any(coalesce(p_regular, '{}') || coalesce(p_specials, '{}'))
  ),
  its as (
    select i.*, eds.ed_rank, (eds.id = any(coalesce(p_specials, '{}'))) as is_special
    from eds cross join lateral public.app_edition_items(eds.id, p_lang, p_aud, v_style, v_uid) i
  ),
  news as (
    select its.item, its.ed_rank, its.pos, its.level,
           coalesce(its.item ->> 'section', '') as sec, coalesce(its.item ->> 'subsection', '') as sub,
           row_number() over (order by public.app_level_rank(its.level) desc, its.published_at desc,
                                       its.pos, its.item_id) as rn
    from its
    where not its.is_special and its.kind = 'news'
      and (not p_filter
           or its.level = 'critical'
           or ((its.topic_id is null or cardinality(v_topics) = 0 or its.topic_id = any(v_topics))
               and public.app_level_rank(its.level) >= v_min_rank))
  ),
  picked as (
    -- sections in the order they first appear (newest edition first; weather last), subsections likewise
    select news.*, (news.item ->> 'topic_id') is not distinct from 'weather' as is_weather,
           min(array[news.ed_rank, news.pos]) over (partition by news.sec) as sec_key,
           min(array[news.ed_rank, news.pos]) over (partition by news.sec, news.sub) as sub_key
    from news
    where not p_filter or news.rn <= v_max
  ),
  sp as (
    select its.item, row_number() over (order by public.app_level_rank(its.level) desc, its.published_at desc,
                                               its.pos) as rn
    from its where its.is_special
  ),
  com as (
    select its.item, its.community_id, its.published_at,
           row_number() over (partition by its.community_id order by its.published_at desc, its.pos) as rn
    from its
    where not its.is_special and its.kind = 'community' and its.community_id = any(v_communities)
  ),
  good as (
    select its.item from its
    where not its.is_special and its.kind = 'good_news'
    order by its.published_at desc, its.pos
    limit 1
  )
  select
    (select coalesce(jsonb_agg(picked.item order by picked.is_weather, picked.sec_key, picked.sub_key,
                                                    public.app_level_rank(picked.level) desc, picked.ed_rank, picked.pos),
                     '[]'::jsonb) from picked),
    (select coalesce(jsonb_agg(sp.item order by sp.rn), '[]'::jsonb) from sp),
    (select coalesce(jsonb_agg(com.item order by array_position(v_communities, com.community_id), com.published_at desc),
                     '[]'::jsonb) from com where com.rn <= public.app_setting_int('community_items_max', 3)),
    (select good.item from good)
  into v_items, v_special, v_community, v_good;

  -- good news fallback: the newest good item of the reader's previous editions within good_news_lookback_hours
  if v_good is null and cardinality(coalesce(p_regular, '{}')) > 0 then
    select i.item into v_good
    from public.app_reader_editions(p_lang, p_aud, p_prof.update_frequency, p_to - make_interval(hours => public.app_setting_int('good_news_lookback_hours', 48)), p_to) rr
    cross join lateral public.app_edition_items(rr.id, p_lang, p_aud, v_style, v_uid) i
    where rr.track <> 'special' and i.kind = 'good_news'
    order by rr.published_at desc, i.pos
    limit 1;
  end if;

  -- ad: free readers only (unless ads_for_premium); the ad of the newest edition in the feed that has one in the reader's language
  if not v_premium or public.app_setting_bool('ads_for_premium', false) then
    for r in
      select e.id from public.tamzit_editions e
      where e.id = any(coalesce(p_regular, '{}')) order by e.created_at desc
    loop
      v_ad := public.app_ad_json(public.app_edition_ad(r.id, p_lang), p_lang);
      exit when v_ad is not null;
    end loop;
  end if;

  -- audio: of the newest edition in the feed that has a playable one; else the newest of the reader's editions
  -- in the last 24 hours (personal edition)
  for r in
    select e.id, e.main_text from public.tamzit_editions e
    where e.id = any(coalesce(p_regular, '{}')) order by e.created_at desc
  loop
    v_audio := public.app_edition_audio(r.id, 'האזנה · ' || coalesce(public.app_edition_title(r.main_text), 'תמצית החדשות'));
    exit when v_audio is not null;
  end loop;
  if v_audio is null and p_filter then
    for r in
      select rr.id, rr.main_text
      from public.app_reader_editions(p_lang, p_aud, p_prof.update_frequency, p_to - interval '24 hours', p_to) rr
      where rr.track <> 'special' and not (rr.id = any(coalesce(p_regular, '{}')))
      order by rr.published_at desc
    loop
      v_audio := public.app_edition_audio(r.id, 'האזנה · ' || coalesce(public.app_edition_title(r.main_text), 'תמצית החדשות'));
      exit when v_audio is not null;
    end loop;
  end if;

  select coalesce(sum(public.app_word_count(x ->> 'headline') + public.app_word_count(x ->> 'body')), 0)
  into v_words
  from jsonb_array_elements(v_items || v_special || v_community
                            || case when v_good is null then '[]'::jsonb else jsonb_build_array(v_good) end) x;

  return jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'edition_types', coalesce(p_types, '[]'::jsonb),
    'title', p_title,
    'items', v_items,
    'special', v_special,
    'community', v_community,
    'good_news', v_good,
    'ad', v_ad,
    'audio', v_audio,
    'minutes', greatest(1, ceil(v_words / greatest(public.app_setting_int('reading_words_per_minute', 180), 1)::numeric)::int),
    'is_premium', v_premium
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_parse_edition(p_text text, p_edition_type text)
 RETURNS TABLE(n integer, section text, subsection text, kind text, headline text, body text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_lines text[] := regexp_split_to_array(replace(coalesce(p_text, ''), E'\r', ''), E'\n');
  v_special boolean := p_edition_type = 'special_update';
  v_active boolean := v_special;
  v_open boolean := false;
  v_section text := null;
  v_kind text := 'news';
  a_section text[] := '{}';
  a_kind text[] := '{}';
  a_raw text[] := '{}';
  s text;
  m text[];
  v_title text;
  v_colon boolean;
  v_n int := 0;
  v_head text;
  v_body text;
  v_split text[];
  c_sep constant text := '^[[:space:]]*•([[:space:]]+•)+[[:space:]]*$';
  c_emoji constant text := '[\u2190-\u2BFF\U0001F000-\U0001FAFF\uFE0F\u200D>]';  -- symbols and emoji, not letters
  c_deny constant text := public.app_regex_any(public.app_setting_texts('parser_skip_section_words',
    array['ערוץ', 'וואטסאפ', 'whatsapp', 'טלגרם', 'telegram', 'עוקבים', 'לשיתוף', 'הצטרפו', 'קמפיין', 'שליחת העדכונים', 'התנצלות', 'קוראים יקרים', 'dear readers', 'chers lecteurs', 'facebook', 'פייסבוק', 'בחסות', 'שיווקי', 'פרסומת', 'sponsor', 'publicit', 'annonce', 'promo', '>>']));
  c_good constant text := public.app_regex_any(public.app_setting_texts('parser_good_news_words',
    array['ונסיים בטוב', 'positive note', 'good note', 'note positive', 'bonne note']));
  c_url constant text := '^(https?://[^[:space:]]+|[A-Za-z0-9.-]+\.(co\.il|org\.il|com|il)/[^[:space:]]*)$';
begin
  foreach s in array v_lines loop
    if s ~ c_sep then
      if v_special then
        exit when cardinality(a_raw) > 0;
        continue;
      end if;
      v_active := false;
      v_open := false;
      continue;
    end if;
    s := btrim(s);
    continue when s = '';
    if v_special and s ~ '^📻' then
      continue;
    end if;

    if not v_special and s !~ '^(•|✓)' then
      m := regexp_match(s, '^(?:' || c_emoji || '|[[:space:]]){0,8}\*_?([^*]+)\*[[:space:]]*(:?)[[:space:]]*$');
      if m is not null then
        v_colon := m[1] ~ ':[[:space:]_]*$' or m[2] = ':';
        v_title := btrim(regexp_replace(m[1], '[[:space:]_:]+$', ''), ' _');
      else
        m := regexp_match(s, '^[[:space:]]*(?:' || c_emoji || '[[:space:]]*){1,4}([^*:]{2,60}):?[[:space:]]*$');
        if m is not null and (s ~ ':[[:space:]]*$' or s ~ '^[[:space:]]*📌') then
          v_colon := true;
          v_title := btrim(m[1]);
        else
          m := null;
        end if;
      end if;
      if m is not null then
        v_active := v_colon and v_title !~* c_deny;
        v_section := v_title;
        v_kind := case when v_title ~* c_good then 'good_news' else 'news' end;
        v_open := false;
        continue;
      end if;
    end if;

    continue when not v_active;
    if s ~ '^•' then
      a_section := a_section || v_section;
      a_kind := a_kind || v_kind;
      a_raw := a_raw || regexp_replace(s, '^•[[:space:]]*', '');
      v_open := true;
      continue;
    end if;
    continue when s ~ c_url;
    if v_open then
      a_raw[cardinality(a_raw)] := a_raw[cardinality(a_raw)] || E'\n' || s;
    else
      a_section := a_section || v_section;
      a_kind := a_kind || v_kind;
      a_raw := a_raw || s;
      v_open := true;
    end if;
  end loop;

  for i in 1 .. cardinality(a_raw) loop
    m := regexp_match(a_raw[i], '^[[:space:]]*\*([^*\n]{2,120})\*[[:space:]]*([:\-–—])?[[:space:]]*(.*)$');
    if m is not null and (m[1] ~ ':[[:space:]]*$' or m[2] is not null) and btrim(m[3]) <> '' then
      v_head := btrim(regexp_replace(public.app_wa_clean(m[1]), '[[:space:]:]+$', ''));
      v_body := public.app_wa_clean(m[3]);
    else
      v_head := '';
      v_body := public.app_wa_clean(a_raw[i]);
    end if;
    continue when v_body = '';
    v_split := public.app_section_split(public.app_wa_clean(a_section[i]));
    v_n := v_n + 1;
    n := v_n;
    section := v_split[1];
    subsection := v_split[2];
    kind := a_kind[i];
    headline := v_head;
    body := v_body;
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_edition_ad(p_edition_id bigint, p_lang text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with g as (select public.app_edition_group(p_edition_id) as ids),
  s as (select * from public.app_edition_span(p_edition_id))
  select el.id
  from public.tamzit_edition_elements el, g, s
  where el.element_type in ('ad', 'donation_campaign', 'cta_link')
    and coalesce(btrim(el.content_text), '') <> ''
    and (el.edition_id = any(g.ids)
         or el.created_at between s.first_at - make_interval(mins => public.app_setting_int('ad_match_before_min', 2))
                             and s.last_at + make_interval(mins => public.app_setting_int('ad_match_after_min', 20)))
    and public.app_text_lang(el.content_text) = p_lang
  order by (el.edition_id = any(g.ids)) desc, (el.element_type = 'ad') desc, el.created_at desc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.app_edition_audio(p_edition_id bigint, p_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.tamzit_editions;
  v_lang text;
  v_span record;
  v_chars int;
  v_rate numeric;
  v_pat text;
  o record;
  v_el record;
  v_url text;
begin
  select * into e from public.tamzit_editions t where t.id = p_edition_id;
  if not found or e.edition_type = 'special_update' then
    return null;
  end if;
  v_lang := public.app_lang_code(e.language);
  select * into v_span from public.app_edition_span(e.id);

  -- 1. The engine's mp3 in the public news-audio bucket; when several fit, the one whose length suits the text.
  v_pat := case v_lang when 'he' then '\)news\.mp3$' when 'fr' then 'news-french\.mp3$' when 'en' then 'news-english\.mp3$' end;
  v_rate := case v_lang when 'he' then public.app_setting_num('audio_chars_per_sec_he', 9.3)
                     else public.app_setting_num('audio_chars_per_sec_other', 13.5) end;
  if v_pat is not null then
    select coalesce(sum(length(p.body) + length(coalesce(p.headline, ''))), 0) into v_chars
    from public.app_parse_edition(e.main_text, e.edition_type) p;
    select so.id, so.name, so.created_at into o
    from storage.objects so
    where so.bucket_id = 'news-audio' and so.name ~ v_pat
      and so.created_at between v_span.first_at - make_interval(mins => public.app_setting_int('audio_match_before_min', 45))
                             and v_span.first_at + make_interval(mins => public.app_setting_int('audio_match_after_min', 2))
    order by case when v_chars > 0 then
               abs(ln(greatest(coalesce((so.metadata ->> 'size')::numeric, 0) * 8 / 142000, 1) / greatest(v_chars / v_rate, 1)))
             else 0 end,
             so.created_at desc
    limit 1;
    if o.id is not null then
      return jsonb_build_object(
        'id', 'na' || replace(o.id::text, '-', ''),
        'kind', 'edition',
        'title', coalesce(p_title, public.app_edition_title(e.main_text), 'תמצית החדשות'),
        'audio_url', public.app_storage_public_base() || '/news-audio/' || public.app_url_encode(o.name),
        'duration_sec', null,
        'published_at', o.created_at);
    end if;
  end if;

  -- 2. The audio element the engine attached (Drive), copied to app-media by app-media-sync.
  select el.id, el.media_id, el.created_at into v_el
  from public.tamzit_edition_elements el
  join public.tamzit_editions le on le.id = el.edition_id
  where el.element_type = 'audio' and el.media_id is not null
    and el.created_at between v_span.first_at - interval '5 seconds' and v_span.last_at + interval '20 minutes'
    and (le.language = e.language or public.app_element_sent_lang(el.created_at) = e.language)
  order by (le.language = e.language and public.app_element_sent_lang(el.created_at) = e.language) desc,
           (public.app_element_sent_lang(el.created_at) = e.language) desc,
           el.created_at
  limit 1;
  if v_el.id is null then
    return null;
  end if;
  v_url := public.app_media_url(v_el.media_id, 'audio');
  if v_url is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', 'au' || v_el.id,
    'kind', 'edition',
    'title', coalesce(p_title, public.app_edition_title(e.main_text), 'תמצית החדשות'),
    'audio_url', v_url,
    'duration_sec', null,
    'published_at', v_el.created_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_ad_json(p_element_id bigint, p_lang text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  el public.tamzit_edition_elements;
  v_lines text[];
  s text;
  v_label text;
  v_sponsor text;
  v_body text[] := '{}';
  v_link text;
  v_image text;
begin
  select * into el from public.tamzit_edition_elements where id = p_element_id;
  if not found or coalesce(btrim(el.content_text), '') = '' then
    return null;
  end if;
  v_lines := regexp_split_to_array(replace(el.content_text, E'\r', ''), E'\n');
  foreach s in array v_lines loop
    s := btrim(s);
    continue when s = '';
    if s ~ '^>' then
      v_label := coalesce(v_label, nullif(btrim(public.app_wa_clean(regexp_replace(s, '^>+[[:space:]]*|[[:space:]:]+$', '', 'g'))), ''));
      continue;
    end if;
    continue when s ~ '^(https?://[^[:space:]]+)$';
    if v_sponsor is null and cardinality(v_body) = 0 and s ~ '^\*[^*]+\*$' then
      v_sponsor := nullif(btrim(public.app_wa_clean(s)), '');
      continue;
    end if;
    v_body := v_body || s;
  end loop;
  v_link := (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1];
  -- the image that went out on WhatsApp: this element's, or that of an identical ad (the engine repeats ads)
  select i.image_url into v_image
  from public.app_ad_images i
  join public.tamzit_edition_elements o on o.id = i.element_id
  where i.element_id = el.id
     or (public.app_ad_norm(o.content_text) = public.app_ad_norm(el.content_text)
         and o.created_at > el.created_at - interval '30 days')
  order by (i.element_id = el.id) desc, i.created_at desc
  limit 1;
  if v_image is null then
    v_image := public.app_media_url(el.media_id, 'image');
  end if;
  if v_image is null and v_link is not null then
    select p.image_url into v_image from public.app_link_previews p where p.url = v_link and p.status = 'ok';
  end if;
  return jsonb_build_object(
    'id', 'ad' || el.id,
    'label', left(coalesce(v_label,
                          nullif(btrim(public.app_setting_text('ad_label_' || case when p_lang in ('en', 'fr') then p_lang else 'he' end)), ''),
                          case p_lang when 'en' then 'Sponsored' when 'fr' then 'Publicité' else 'פרסומת' end), 80),
    'sponsor', left(v_sponsor, 120),
    'body', public.app_wa_clean(array_to_string(v_body, E'\n')),
    'link_url', v_link,
    'image_url', v_image
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_media_queue(p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_files jsonb;
  v_links jsonb;
  -- English audio copies live at most a day (english_audio_keep_hours, capped at 24)
  v_audio_keep interval := make_interval(hours => least(greatest(public.app_setting_int('english_audio_keep_hours', 24), 1), 24));
begin
  insert into public.app_media (drive_id, source_url, kind)
  select distinct on (public.app_drive_id(el.media_id)) public.app_drive_id(el.media_id), el.media_id,
         case when el.element_type = 'audio' then 'audio' end
  from public.tamzit_edition_elements el
  left join public.tamzit_editions le on le.id = el.edition_id
  where public.app_drive_id(el.media_id) is not null
    and ((el.element_type in ('ad', 'donation_campaign', 'cta_link') and el.created_at > now() - make_interval(days => public.app_setting_int('ad_image_days', 30)))
         or (el.element_type = 'audio' and el.created_at > now() - v_audio_keep
             and (le.language = 'english' or public.app_element_sent_lang(el.created_at) = 'english')))
  order by public.app_drive_id(el.media_id), el.id desc
  on conflict (drive_id) do nothing;

  insert into public.app_link_previews (url)
  select distinct (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1]
  from public.tamzit_edition_elements el
  where el.element_type in ('ad', 'donation_campaign', 'cta_link') and el.created_at > now() - make_interval(days => public.app_setting_int('ad_image_days', 30))
    and el.content_text ~ 'https?://'
  on conflict (url) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object('drive_id', m.drive_id, 'kind', m.kind)), '[]'::jsonb) into v_files
  from (
    select m.drive_id, m.kind from public.app_media m
    where m.status in ('pending', 'private', 'failed') and m.next_try_at <= now() and m.tries < 40
      and not (m.kind = 'audio' and m.created_at < now() - v_audio_keep)   -- too old to be worth copying
    order by m.created_at desc
    limit p_limit
  ) m;
  select coalesce(jsonb_agg(jsonb_build_object('url', p.url)), '[]'::jsonb) into v_links
  from (
    select p.url from public.app_link_previews p
    where p.status in ('pending', 'failed') and p.next_try_at <= now() and p.tries < 8
    order by p.created_at desc
    limit p_limit
  ) p;
  return jsonb_build_object('files', v_files, 'links', v_links);
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_family_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status <> 'removed' and (
    select count(*) from public.app_family_members m
    where m.owner_id = new.owner_id and m.status <> 'removed' and m.member_phone <> new.member_phone
  ) >= public.app_setting_int('family_max_members', 4) then
    raise exception using errcode = 'P0001', message = 'family_full';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_search(p_query text, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prof public.user_preferences := public.app_require_profile();
  v_lang text := coalesce(public.app_lang_code(v_prof.language), 'he');
  v_aud text := case when v_prof.audience = 'youth' then 'youth' else 'general' end;
  v_style text := public.app_style_of(v_prof.persona);
  v_q text := btrim(coalesce(p_query, ''));
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_pat text;
  v_out jsonb;
begin
  if not public.app_is_premium(v_prof.user_id) then
    raise exception using errcode = 'P0001', message = 'premium_required';
  end if;
  if length(v_q) < greatest(public.app_setting_int('search_min_chars', 2), 1) then
    return '[]'::jsonb;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with eds as (
    select r.id, r.published_at
    from public.app_reader_editions(v_lang, v_aud, v_prof.update_frequency, now() - interval '3650 days', now()) r
    where r.main_text ilike v_pat
       or exists (select 1 from public.tamzit_edition_elements el
                  join public.processed_stories s on s.id = el.story_id
                  where el.edition_id = r.id and el.element_type = 'story'
                    and (s.versions::text ilike v_pat or s.title ilike v_pat or s.summary ilike v_pat))
    order by r.published_at desc
    limit 40
  ),
  hits as (
    select i.item, eds.published_at, i.pos
    from eds cross join lateral public.app_edition_items(eds.id, v_lang, v_aud, v_style, v_prof.user_id) i
    where i.kind <> 'community' or i.community_id = any(coalesce(v_prof.communities, '{}'))
  )
  select coalesce(jsonb_agg(h.item order by h.published_at desc, h.pos), '[]'::jsonb) into v_out
  from (
    select * from hits
    where hits.item ->> 'headline' ilike v_pat or hits.item ->> 'body' ilike v_pat
    order by hits.published_at desc, hits.pos
    limit v_limit
  ) h;
  return v_out;
end;
$function$;

-- ===========================================================================
-- Privileges: the readers are server-only (called inside the security-definer RPCs, the triggers and the edge
-- functions, which use the service role).
-- ===========================================================================
revoke execute on function public.app_settings_check() from public, anon, authenticated;
revoke execute on function public.app_setting_int(text, int) from public, anon, authenticated;
revoke execute on function public.app_setting_num(text, numeric) from public, anon, authenticated;
revoke execute on function public.app_setting_bool(text, boolean) from public, anon, authenticated;
revoke execute on function public.app_setting_texts(text, text[]) from public, anon, authenticated;
revoke execute on function public.app_regex_any(text[]) from public, anon, authenticated;
grant execute on function public.app_setting_int(text, int) to service_role;
grant execute on function public.app_setting_num(text, numeric) to service_role;
grant execute on function public.app_setting_bool(text, boolean) to service_role;
grant execute on function public.app_setting_texts(text, text[]) to service_role;
grant execute on function public.app_regex_any(text[]) to service_role;
