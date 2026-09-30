-- Tamzit app: topic and importance of every news item, classified by Jev (TypeSafe's non-generative "System One"
-- decision model; https://docs.typesafe.ai).
--
-- For each distinct news item of the recent editions (the parsed items; the same text in a repeated insert of an
-- edition is classified once), the app-classify edge function asks Jev, in one request:
--   * one yes/no question (Noul) per topic of app_topics ("is this item about X?", with the definition of X and
--     what does not belong to it): an item can have several topics; a topic counts from jev_topic_threshold;
--   * one Score question with three ordered levels: general / important / critical (the app's levels).
-- The answers (all probabilities, the model version) are kept in app_item_labels.
--
-- Shadow mode first: while app_settings.jev_apply_to_feed is false (the default) nothing changes in the app; the
-- labels can be reviewed in the view app_item_labels_review. When it is true, a parsed item's topics and level
-- come from its label (topic filter: any of its topics; level: the Score answer when its confidence reaches
-- jev_importance_min_confidence), else as before (topic by section keywords, level "important").
--
-- Runs only when the TYPESAFE_API_KEY secret is set and app_settings.jev_enabled is true. Triggered by pg_cron every
-- 5 minutes and right after an edition is saved. Idempotent.

create table if not exists public.app_item_labels (
  text_hash              text primary key,          -- app_item_hash(lang, headline, body)
  status                 text not null default 'pending' check (status in ('pending', 'ok', 'failed')),
  tries                  int not null default 0,
  next_try_at            timestamptz not null default now(),
  lang                   text,
  item_id                text,                        -- where it was first seen ('e<edition id>-<n>')
  section                text,
  headline               text,
  excerpt                text,                        -- first 300 characters of the body (for review)
  topics                 text[] not null default '{}',-- topic ids at or above jev_topic_threshold, most likely first
  topic_probs            jsonb,                       -- {topic id: probability of yes}
  importance             text check (importance in ('general', 'important', 'critical')),
  importance_probs       jsonb,                       -- {"general": p, "important": p, "critical": p}
  importance_confidence  numeric,
  model                  text,
  input_tokens           int,
  error                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.app_item_labels enable row level security;   -- server only (no policies)
revoke all on public.app_item_labels from anon, authenticated;
create index if not exists app_item_labels_retry_idx on public.app_item_labels (status, next_try_at);

-- Identity of an item's text (language + headline + body).
create or replace function public.app_item_hash(p_lang text, p_headline text, p_body text) returns text
language sql immutable set search_path = public as $$
  select md5(coalesce(p_lang, '') || chr(31) || coalesce(p_headline, '') || chr(31) || coalesce(p_body, ''));
$$;

-- Claims up to p_limit news items of the last jev_lookback_hours that have no label yet (or whose last try failed
-- and is due, or whose claim is older than 10 minutes) and returns them for app-classify. A claimed item is not
-- returned to a concurrent call.
create or replace function public.app_label_queue(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_hours int := least(greatest(public.app_setting_int('jev_lookback_hours', 24), 1), 168);
  v_out jsonb;
begin
  with eds as (
    select distinct on (e.language, md5(coalesce(e.main_text, ''))) e.id, e.language, e.main_text, e.edition_type, e.created_at
    from public.tamzit_editions e
    where e.created_at > now() - make_interval(hours => v_hours) and e.created_at <= now()
    order by e.language, md5(coalesce(e.main_text, '')), e.created_at
  ),
  its as (
    select distinct on (h) *
    from (
      select public.app_item_hash(public.app_lang_code(eds.language), p.headline, p.body) as h,
             public.app_lang_code(eds.language) as lang, 'e' || eds.id || '-' || p.n as item_id,
             p.section, p.subsection, p.headline, p.body, eds.created_at
      from eds cross join lateral public.app_parse_edition(eds.main_text, eds.edition_type) p
      where p.kind = 'news'
    ) x
    order by h, created_at
  ),
  todo as (
    select its.* from its
    left join public.app_item_labels l on l.text_hash = its.h
    where l.text_hash is null
       or (l.status = 'failed' and l.next_try_at <= now() and l.tries < 6)
       or (l.status = 'pending' and l.updated_at < now() - interval '10 minutes' and l.tries < 6)
    order by its.created_at desc
    limit greatest(coalesce(p_limit, 20), 1)
  ),
  claimed as (
    insert into public.app_item_labels as l (text_hash, status, tries, lang, item_id, section, headline, excerpt, updated_at)
    select todo.h, 'pending', 1, todo.lang, todo.item_id, concat_ws(' / ', todo.section, todo.subsection),
           nullif(todo.headline, ''), left(todo.body, 300), now()
    from todo
    on conflict (text_hash) do update set status = 'pending', tries = l.tries + 1, updated_at = now()
      where l.status <> 'ok'
        and ((l.status = 'failed' and l.next_try_at <= now())
             or (l.status = 'pending' and l.updated_at < now() - interval '10 minutes'))
    returning l.text_hash
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'hash', todo.h, 'lang', todo.lang, 'item_id', todo.item_id, 'section', todo.section,
           'subsection', todo.subsection, 'headline', todo.headline, 'body', todo.body)), '[]'::jsonb)
  into v_out
  from todo join claimed c on c.text_hash = todo.h;
  return v_out;
end;
$$;

-- Starts app-classify (pg_net; returns at once). Does nothing when jev_enabled is false.
create or replace function public.app_label_kick() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := public.app_setting_text('functions_base_url');
begin
  if v_url is null or not public.app_setting_bool('jev_enabled', true) then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/app-classify',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-app-secret', coalesce(public.app_setting_text('push_webhook_secret'), '')),
    timeout_milliseconds := 60000);
exception when others then
  raise warning 'app_label_kick: %', sqlerrm;
end;
$$;

-- A new edition text: classify its items right away (the engine inserts each edition several times; only the first
-- insert of a text kicks).
create or replace function public.app_tamzit_editions_classify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.created_at < now() - interval '2 hours' or new.created_at > now() + interval '1 hour' then
      return new;
    end if;
    if exists (select 1 from public.tamzit_editions e
               where e.id <> new.id and e.language is not distinct from new.language
                 and e.created_at > now() - interval '30 minutes'
                 and md5(coalesce(e.main_text, '')) = md5(coalesce(new.main_text, ''))) then
      return new;
    end if;
    perform public.app_label_kick();
  exception when others then
    raise warning 'app_tamzit_editions_classify: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists app_tamzit_editions_classify on public.tamzit_editions;
create trigger app_tamzit_editions_classify after insert on public.tamzit_editions
  for each row execute function public.app_tamzit_editions_classify();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'app-classify') then
    perform cron.unschedule('app-classify');
  end if;
  perform cron.schedule('app-classify', '*/5 * * * *', 'select public.app_label_kick()');
end;
$$;

-- For review in the table editor: the newest labels with the section-based topic of before.
create or replace view public.app_item_labels_review with (security_invoker = true) as
select l.created_at, l.lang, l.item_id, l.section,
       public.app_topic_for(l.section) as section_topic,
       l.topics as jev_topics, l.importance as jev_importance, round(l.importance_confidence, 2) as confidence,
       l.headline, l.excerpt, l.topic_probs, l.importance_probs, l.model, l.status, l.error
from public.app_item_labels l;
revoke all on public.app_item_labels_review from anon, authenticated;

-- ===========================================================================
-- Parameters (app_settings catalog, see 0015)
-- ===========================================================================

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('jev_enabled', 'true'::jsonb, 'הפעלת סיווג הידיעות ב-Jev', 'מה זה: כש-true, כל ידיעה חדשה נשלחת ל-Jev (מודל ההחלטה הלא-גנרטיבי של TypeSafe), שמחזיר את הנושאים שלה ואת רמת החשיבות. הסיווג רץ רק אם הוגדר הסוד TYPESAFE_API_KEY ב-Supabase (Edge Functions → Secrets). false עוצר את הסיווג; תוויות שכבר נשמרו נשארות.
על מה זה משפיע: אם נוצרות תוויות חדשות בטבלה app_item_labels (עלות: בערך 0.04 דולר למיליון טוקנים, כלומר סנטים בחודש).
איפה זה ממומש: שרת: public.app_label_kick (הפעלה כל 5 דקות וכשנשמרת מהדורה, מיגרציה 0016) ופונקציית הקצה supabase/functions/app-classify/index.ts.
פורמט: true או false, בלי מירכאות.', 'סיווג ידיעות (Jev)', 'bool', '{}'::jsonb, 'true'::jsonb, false, false, 1000),
  ('jev_apply_to_feed', 'false'::jsonb, 'שימוש בסיווג של Jev במהדורה', 'מה זה: false (מצב צל): התוויות נשמרות ואפשר לבדוק אותן בתצוגה app_item_labels_review, אבל האפליקציה לא משתנה. true: הנושאים של ידיעה נלקחים מ-Jev (במקום לפי כותרת המדור), והסינון לפי נושאים מראה ידיעה אם אחד הנושאים שלה נבחר. גם רמת החשיבות נלקחת מ-Jev (כללי / חשוב / קריטי), כשהביטחון בה מגיע ל-jev_importance_min_confidence. אחרת הרמה נשארת "חשוב", כמו היום.
על מה זה משפיע: אילו ידיעות כל קורא רואה, לפי הנושאים ורמת החשיבות שבחר. מומלץ להפעיל רק אחרי בדיקה של כמה ימים במצב צל.
איפה זה ממומש: שרת: public.app_parsed_item_json ו-public.app_build_feed (מיגרציה 0016).
פורמט: true או false, בלי מירכאות.', 'סיווג ידיעות (Jev)', 'bool', '{}'::jsonb, 'false'::jsonb, false, false, 1010),
  ('jev_model', '"jev-1.13.0"'::jsonb, 'גרסת מודל Jev', 'מה זה: שם המודל שנשלח ל-TypeSafe. מומלץ להצמיד לגרסה (למשל "jev-1.13.0") ולא ל-"jev-latest", כי ספי הביטחון מכוילים לגרסה מסוימת. כל תווית שומרת את הגרסה שסיווגה אותה.
על מה זה משפיע: איזה מודל מסווג.
איפה זה ממומש: שרת: supabase/functions/app-classify/index.ts.
פורמט: טקסט בתוך מירכאות כפולות. דוגמה: "jev-1.13.0".', 'סיווג ידיעות (Jev)', 'text', '{"pattern": "^jev-[a-z0-9.\\-]+$", "max_length": 40}'::jsonb, '"jev-1.13.0"'::jsonb, false, false, 1020),
  ('jev_topic_threshold', '0.7'::jsonb, 'סף ההסתברות לנושא', 'מה זה: לכל נושא ב-app_topics שואלים את Jev שאלת כן/לא, והוא מחזיר הסתברות בין 0 ל-1. נושא נכנס לתווית של הידיעה אם ההסתברות שלו לפחות הסף הזה. לידיעה יכולים להיות כמה נושאים. סף גבוה יותר נותן פחות נושאים, ושגיאות מסוג "נושא לא קשור" נעשות נדירות יותר.
על מה זה משפיע: אילו נושאים נשמרים לכל ידיעה (ההסתברויות של כל הנושאים נשמרות בכל מקרה).
איפה זה ממומש: שרת: supabase/functions/app-classify/index.ts (readAnswers).
פורמט: מספר (אפשר עם נקודה עשרונית), בלי מירכאות, בין 0.3 ל-0.99. דוגמה: 0.7.', 'סיווג ידיעות (Jev)', 'number', '{"min": 0.3, "max": 0.99}'::jsonb, '0.7'::jsonb, false, false, 1030),
  ('jev_importance_min_confidence', '0.5'::jsonb, 'ביטחון מינימלי ברמת החשיבות', 'מה זה: Jev מחזיר לרמת החשיבות הסתברות לכל אחת משלוש הרמות, וגם מדד ביטחון בין 0 ל-1. מתחת לסף הזה המהדורה מתעלמת מהרמה שלו, והידיעה נשארת ברמה "חשוב".
על מה זה משפיע: אילו ידיעות מסומנות כלליות או קריטיות במהדורה (רק כש-jev_apply_to_feed פעיל).
איפה זה ממומש: שרת: public.app_parsed_item_json (מיגרציה 0016).
פורמט: מספר (אפשר עם נקודה עשרונית), בלי מירכאות, בין 0 ל-1. דוגמה: 0.5.', 'סיווג ידיעות (Jev)', 'number', '{"min": 0, "max": 1}'::jsonb, '0.5'::jsonb, false, false, 1040),
  ('jev_lookback_hours', '24'::jsonb, 'כמה שעות אחורה מסווגים', 'מה זה: ידיעות מהמהדורות של השעות האלה שעדיין לא סווגו נשלחות לסיווג. אפשר להעלות זמנית (עד 168, שבוע) כדי לסווג ידיעות קודמות לבדיקה.
על מה זה משפיע: אילו ידיעות נכנסות לתור הסיווג.
איפה זה ממומש: שרת: public.app_label_queue (מיגרציה 0016).
פורמט: מספר שלם, בלי מירכאות, בין 1 ל-168. דוגמה: 24.', 'סיווג ידיעות (Jev)', 'int', '{"min": 1, "max": 168}'::jsonb, '24'::jsonb, false, false, 1050),
  ('jev_rubric', '{"topics": {"politics": {"covers": "Israeli domestic politics and government: the Knesset, coalition and opposition, ministers and government decisions, parties, elections and polls, political appointments.", "not_for": "military operations (security), court rulings and police investigations (law), the internal politics of other countries (world)."}, "security": {"covers": "Israel''s security and defense: IDF operations, wars and fronts (Gaza, Lebanon, Syria, Iran, Yemen, Judea and Samaria), terror attacks, rockets, drones and sirens, hostages, soldiers killed or wounded, Home Front Command instructions.", "not_for": "crime without a security or terror aspect (law), diplomacy without military action (world or politics)."}, "economy": {"covers": "the economy and finance: markets and the stock exchange, the Bank of Israel and interest rates, inflation, the state budget and taxes, companies and deals, employment and wages, the housing market.", "not_for": "practical prices, benefits and consumer rights of households (consumer)."}, "health": {"covers": "health and medicine: hospitals and the health system, diseases and epidemics, medical research and treatments, vaccines, Health Ministry instructions, mental health."}, "education": {"covers": "education: schools and kindergartens, universities and colleges, students, pupils and teachers, the school calendar and exams, Education Ministry decisions."}, "law": {"covers": "law and crime: courts and rulings, indictments and trials, police investigations, crime, murders and arrests, the attorney general, judicial reform.", "not_for": "terror attacks and security incidents (security)."}, "world": {"covers": "world news: events in other countries, international diplomacy and organizations, foreign leaders and elections abroad, global crises, Israel''s foreign relations."}, "science": {"covers": "science and technology: research and discoveries, space, artificial intelligence, high-tech and startups, the internet and cyber, devices and apps."}, "transport": {"covers": "transport and traffic: roads and road accidents, public transport, trains, flights and airports, fuel prices, traffic arrangements and closures."}, "weather": {"covers": "weather and nature: forecasts, rain, heat waves, storms, floods, earthquakes, air quality."}, "consumer": {"covers": "consumer affairs: prices of goods and services, consumer rights, product recalls, benefits and allowances, practical information for households."}, "judaism": {"covers": "Judaism and tradition: Jewish holidays and their customs, rabbis and halachic rulings, synagogues and yeshivas, religious services, the Chief Rabbinate, Torah and Jewish life."}, "culture": {"covers": "culture and entertainment: music, film, television, theatre, books, art, celebrities, festivals and events."}, "sports": {"covers": "sports: games and results, leagues, teams and athletes, competitions."}}, "importance": {"instructions": "How important is this news item for a reader in Israel today?", "levels": ["General: routine, local or soft news; interesting background that changes nothing for most readers today.", "Important: significant news most readers in Israel would want to know today, without immediate danger or a need to act.", "Critical: breaking or exceptional news of major national impact, or news that requires readers to act or take care now (war events, attacks with casualties, rocket alerts and Home Front instructions, major disasters, emergency decisions)."]}}'::jsonb, 'הגדרות הנושאים ורמות החשיבות ל-Jev', 'מה זה: ההגדרות ש-Jev מקבל, באנגלית (השפה ש-Jev מבין הכי טוב; הידיעות עצמן נשלחות בשפה המקורית). topics: לכל מזהה נושא מ-app_topics יש covers (מה שייך לנושא) ואפשר גם not_for (מה לא שייך, כדי להפריד בין נושאים קרובים). נושא בלי הגדרה נשאל רק לפי שמו האנגלי. importance: instructions (השאלה) ו-levels, שלוש רמות מהנמוכה לגבוהה: כללי, חשוב, קריטי. זה המקום לשפר את הדיוק: לחדד הגדרה, להוסיף not_for, או לתאר רמה טוב יותר.
על מה זה משפיע: הדיוק של הסיווג.
איפה זה ממומש: שרת: supabase/functions/app-classify/index.ts (questions).
פורמט: אובייקט JSON בסוגריים מסולסלים, באותו מבנה כמו ערך ברירת המחדל (default_value).', 'סיווג ידיעות (Jev)', 'json', '{}'::jsonb, '{"topics": {"politics": {"covers": "Israeli domestic politics and government: the Knesset, coalition and opposition, ministers and government decisions, parties, elections and polls, political appointments.", "not_for": "military operations (security), court rulings and police investigations (law), the internal politics of other countries (world)."}, "security": {"covers": "Israel''s security and defense: IDF operations, wars and fronts (Gaza, Lebanon, Syria, Iran, Yemen, Judea and Samaria), terror attacks, rockets, drones and sirens, hostages, soldiers killed or wounded, Home Front Command instructions.", "not_for": "crime without a security or terror aspect (law), diplomacy without military action (world or politics)."}, "economy": {"covers": "the economy and finance: markets and the stock exchange, the Bank of Israel and interest rates, inflation, the state budget and taxes, companies and deals, employment and wages, the housing market.", "not_for": "practical prices, benefits and consumer rights of households (consumer)."}, "health": {"covers": "health and medicine: hospitals and the health system, diseases and epidemics, medical research and treatments, vaccines, Health Ministry instructions, mental health."}, "education": {"covers": "education: schools and kindergartens, universities and colleges, students, pupils and teachers, the school calendar and exams, Education Ministry decisions."}, "law": {"covers": "law and crime: courts and rulings, indictments and trials, police investigations, crime, murders and arrests, the attorney general, judicial reform.", "not_for": "terror attacks and security incidents (security)."}, "world": {"covers": "world news: events in other countries, international diplomacy and organizations, foreign leaders and elections abroad, global crises, Israel''s foreign relations."}, "science": {"covers": "science and technology: research and discoveries, space, artificial intelligence, high-tech and startups, the internet and cyber, devices and apps."}, "transport": {"covers": "transport and traffic: roads and road accidents, public transport, trains, flights and airports, fuel prices, traffic arrangements and closures."}, "weather": {"covers": "weather and nature: forecasts, rain, heat waves, storms, floods, earthquakes, air quality."}, "consumer": {"covers": "consumer affairs: prices of goods and services, consumer rights, product recalls, benefits and allowances, practical information for households."}, "judaism": {"covers": "Judaism and tradition: Jewish holidays and their customs, rabbis and halachic rulings, synagogues and yeshivas, religious services, the Chief Rabbinate, Torah and Jewish life."}, "culture": {"covers": "culture and entertainment: music, film, television, theatre, books, art, celebrities, festivals and events."}, "sports": {"covers": "sports: games and results, leagues, teams and athletes, competitions."}}, "importance": {"instructions": "How important is this news item for a reader in Israel today?", "levels": ["General: routine, local or soft news; interesting background that changes nothing for most readers today.", "Important: significant news most readers in Israel would want to know today, without immediate danger or a need to act.", "Critical: breaking or exceptional news of major national impact, or news that requires readers to act or take care now (war events, attacks with casualties, rocket alerts and Home Front instructions, major disasters, emergency decisions)."]}}'::jsonb, false, false, 1060)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- ===========================================================================
-- The feed: labels are used only when jev_apply_to_feed is true (definitions of 0011 / 0015 otherwise unchanged)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.app_parsed_item_json(p_edition tamzit_editions, p_n integer, p_section text, p_subsection text, p_kind text, p_headline text, p_body text, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lab as (   -- the Jev label of this text, when jev_apply_to_feed is on
    select l.topics, l.importance, l.importance_confidence
    from public.app_item_labels l
    where p_kind = 'news' and public.app_setting_bool('jev_apply_to_feed', false)
      and l.text_hash = public.app_item_hash(public.app_lang_code(p_edition.language), p_headline, p_body)
      and l.status = 'ok'
  )
  select jsonb_build_object(
    'id', 'e' || p_edition.id || '-' || p_n,
    'topic_id', coalesce((select lab.topics[1] from lab where cardinality(lab.topics) > 0),
                       public.app_topic_for(concat_ws(' / ', p_section, p_subsection))),
    'topic_name', coalesce(p_subsection, p_section),
    'section', p_section,
    'subsection', p_subsection,
    'level', case when p_edition.edition_type = 'special_update' then 'critical'
                 else coalesce((select lab.importance from lab
                                where lab.importance_confidence >= public.app_setting_num('jev_importance_min_confidence', 0.5)),
                               'important') end,
    'kind', p_kind,
    'community_id', null,
    'community_name', null,
    'headline', p_headline,
    'body', p_body,
    'style', 'informative',
    'published_at', p_edition.created_at,
    'corrected_at', null,
    'saved', exists (select 1 from public.app_saved_items x
                     where x.profile_id = p_uid and x.item_id = 'e' || p_edition.id || '-' || p_n))
    -- all of the item's topics (the topic filter shows it when any of them was picked)
    || coalesce((select jsonb_build_object('topics', to_jsonb(lab.topics)) from lab where cardinality(lab.topics) > 0),
                '{}'::jsonb);
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
           or ((its.topic_id is null or cardinality(v_topics) = 0 or its.topic_id = any(v_topics)
                or coalesce(its.item -> 'topics', '[]'::jsonb) ?| v_topics)
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

-- Privileges: server only.
revoke execute on function public.app_item_hash(text, text, text) from public, anon, authenticated;
revoke execute on function public.app_label_queue(int) from public, anon, authenticated;
revoke execute on function public.app_label_kick() from public, anon, authenticated;
revoke execute on function public.app_tamzit_editions_classify() from public, anon, authenticated;
grant execute on function public.app_item_hash(text, text, text) to service_role;
grant execute on function public.app_label_queue(int) to service_role;
grant execute on function public.app_label_kick() to service_role;
