-- Tamzit app: every item has a topic, and no item is hidden by its level.
-- Jev now also answers a Choice question, the item's main topic (always one: the closest), stored in
-- app_item_labels.main_topic and used as the item's topic_id; the yes/no topics add further topics. Importance has
-- two levels only, important and critical: an item is critical only when Jev says so with enough confidence, else
-- important, as before Jev ("general" is gone, so "critical and important" readers never lose items such as weather or
-- sports). The rubric in app_settings.jev_rubric is converted once from three levels to two (a rubric someone edited
-- since is kept). Idempotent.

alter table public.app_item_labels add column if not exists main_topic text;
alter table public.app_item_labels add column if not exists main_topic_probs jsonb;

update public.app_settings set value = '{"topics": {"politics": {"covers": "Israeli domestic politics and government: the Knesset, coalition and opposition, ministers and government decisions, parties, elections and polls, political appointments.", "not_for": "military operations (security), court rulings and police investigations (law), the internal politics of other countries (world)."}, "security": {"covers": "Israel''s security and defense: IDF operations, wars and fronts (Gaza, Lebanon, Syria, Iran, Yemen, Judea and Samaria), threats and attacks by Iran and its proxies (Hezbollah, Hamas, the Houthis) anywhere in the region, including at sea, terror attacks, rockets, drones and sirens, hostages, soldiers killed or wounded, Home Front Command instructions.", "not_for": "crime without a security or terror aspect (law), diplomacy without military action (world or politics)."}, "economy": {"covers": "the economy and finance: markets and the stock exchange, the Bank of Israel and interest rates, inflation, the state budget and taxes, companies and deals, employment and wages, the housing market.", "not_for": "practical prices, benefits and consumer rights of households (consumer)."}, "health": {"covers": "health and medicine: hospitals and the health system, diseases and epidemics, medical research and treatments, vaccines, Health Ministry instructions, mental health."}, "education": {"covers": "education: schools and kindergartens, universities and colleges, students, pupils and teachers, the school calendar and exams, Education Ministry decisions."}, "law": {"covers": "law and crime: courts and rulings, indictments and trials, police investigations, crime, murders and arrests, the attorney general, judicial reform.", "not_for": "terror attacks and security incidents (security)."}, "world": {"covers": "world news: events in other countries, international diplomacy and organizations, foreign leaders and elections abroad, global crises, Israel''s foreign relations."}, "science": {"covers": "science and technology: research and discoveries, space, artificial intelligence, high-tech and startups, the internet and cyber, devices and apps."}, "transport": {"covers": "transport and traffic: roads and road accidents, public transport, trains, flights and airports, fuel prices, traffic arrangements and closures."}, "weather": {"covers": "weather and nature: forecasts, rain, heat waves, storms, floods, earthquakes, air quality."}, "consumer": {"covers": "consumer affairs: prices of goods and services, consumer rights, product recalls, benefits and allowances, practical information for households."}, "judaism": {"covers": "Judaism and tradition: Jewish holidays and their customs, rabbis and halachic rulings, synagogues and yeshivas, religious services, the Chief Rabbinate, Torah and Jewish life."}, "culture": {"covers": "culture and entertainment: music, film, television, theatre, books, art, celebrities, festivals and events."}, "sports": {"covers": "sports: games and results, leagues, teams and athletes, competitions."}}, "importance": {"instructions": "How important is this news item for a reader in Israel today?", "levels": ["Important: news that belongs in the edition, of any topic (politics, security, economy, weather, sports, culture and the rest), including routine military activity, forecasts and results. Almost every item is at this level.", "Critical: exceptional news of major national impact, or news that requires readers to act or take care now: Israelis killed in an attack or in combat, a mass-casualty event, a major escalation or a new front, rocket or drone alerts and Home Front instructions, a major disaster, the death of a national figure, emergency government decisions. Routine military activity, even the elimination of commanders, is not critical."]}}'::jsonb
where key = 'jev_rubric' and jsonb_array_length(coalesce(value -> 'importance' -> 'levels', '[]'::jsonb)) = 3;
update public.app_settings set default_value = '{"topics": {"politics": {"covers": "Israeli domestic politics and government: the Knesset, coalition and opposition, ministers and government decisions, parties, elections and polls, political appointments.", "not_for": "military operations (security), court rulings and police investigations (law), the internal politics of other countries (world)."}, "security": {"covers": "Israel''s security and defense: IDF operations, wars and fronts (Gaza, Lebanon, Syria, Iran, Yemen, Judea and Samaria), threats and attacks by Iran and its proxies (Hezbollah, Hamas, the Houthis) anywhere in the region, including at sea, terror attacks, rockets, drones and sirens, hostages, soldiers killed or wounded, Home Front Command instructions.", "not_for": "crime without a security or terror aspect (law), diplomacy without military action (world or politics)."}, "economy": {"covers": "the economy and finance: markets and the stock exchange, the Bank of Israel and interest rates, inflation, the state budget and taxes, companies and deals, employment and wages, the housing market.", "not_for": "practical prices, benefits and consumer rights of households (consumer)."}, "health": {"covers": "health and medicine: hospitals and the health system, diseases and epidemics, medical research and treatments, vaccines, Health Ministry instructions, mental health."}, "education": {"covers": "education: schools and kindergartens, universities and colleges, students, pupils and teachers, the school calendar and exams, Education Ministry decisions."}, "law": {"covers": "law and crime: courts and rulings, indictments and trials, police investigations, crime, murders and arrests, the attorney general, judicial reform.", "not_for": "terror attacks and security incidents (security)."}, "world": {"covers": "world news: events in other countries, international diplomacy and organizations, foreign leaders and elections abroad, global crises, Israel''s foreign relations."}, "science": {"covers": "science and technology: research and discoveries, space, artificial intelligence, high-tech and startups, the internet and cyber, devices and apps."}, "transport": {"covers": "transport and traffic: roads and road accidents, public transport, trains, flights and airports, fuel prices, traffic arrangements and closures."}, "weather": {"covers": "weather and nature: forecasts, rain, heat waves, storms, floods, earthquakes, air quality."}, "consumer": {"covers": "consumer affairs: prices of goods and services, consumer rights, product recalls, benefits and allowances, practical information for households."}, "judaism": {"covers": "Judaism and tradition: Jewish holidays and their customs, rabbis and halachic rulings, synagogues and yeshivas, religious services, the Chief Rabbinate, Torah and Jewish life."}, "culture": {"covers": "culture and entertainment: music, film, television, theatre, books, art, celebrities, festivals and events."}, "sports": {"covers": "sports: games and results, leagues, teams and athletes, competitions."}}, "importance": {"instructions": "How important is this news item for a reader in Israel today?", "levels": ["Important: news that belongs in the edition, of any topic (politics, security, economy, weather, sports, culture and the rest), including routine military activity, forecasts and results. Almost every item is at this level.", "Critical: exceptional news of major national impact, or news that requires readers to act or take care now: Israelis killed in an attack or in combat, a mass-casualty event, a major escalation or a new front, rocket or drone alerts and Home Front instructions, a major disaster, the death of a national figure, emergency government decisions. Routine military activity, even the elimination of commanders, is not critical."]}}'::jsonb, description = 'מה זה: ההגדרות ש-Jev מקבל, באנגלית (השפה ש-Jev מבין הכי טוב; הידיעות עצמן נשלחות בשפה המקורית). topics: לכל מזהה נושא מ-app_topics יש covers (מה שייך לנושא) ואפשר גם not_for (מה לא שייך, כדי להפריד בין נושאים קרובים). ההגדרות משמשות גם לבחירת הנושא הראשי (תמיד נושא אחד, הקרוב ביותר) וגם לשאלות הכן/לא על שאר הנושאים. importance: instructions (השאלה) ו-levels, שתי רמות מהנמוכה לגבוהה: חשוב, קריטי. אין רמה "כללי", כדי שאף ידיעה לא תוסתר. זה המקום לשפר את הדיוק: לחדד הגדרה, להוסיף not_for, או לתאר רמה טוב יותר.
על מה זה משפיע: הדיוק של הסיווג.
איפה זה ממומש: שרת: supabase/functions/app-classify/index.ts (questions).
פורמט: אובייקט JSON בסוגריים מסולסלים, באותו מבנה כמו ערך ברירת המחדל (default_value).' where key = 'jev_rubric';
update public.app_settings set description = 'מה זה: false (מצב צל): התוויות נשמרות ואפשר לבדוק אותן בתצוגה app_item_labels_review, אבל האפליקציה לא משתנה. true: הנושא הראשי של ידיעה נלקח מ-Jev (תמיד יש אחד: הקרוב ביותר), והסינון לפי נושאים מראה ידיעה אם אחד הנושאים שלה נבחר: הנושאים ש-Jev מצא, וגם הנושא של המדור שבו העורכים שמו אותה. רמת החשיבות היא "חשוב", ו"קריטי" רק כש-Jev אומר קריטי בוודאות של jev_importance_min_confidence לפחות. אין רמה "כללי", ולכן הסינון לפי חשיבות לא מסתיר ידיעות ממי שבחר "קריטיות וחשובות".
על מה זה משפיע: אילו ידיעות כל קורא רואה, לפי הנושאים שבחר, ואילו ידיעות מסומנות קריטיות.
איפה זה ממומש: שרת: public.app_parsed_item_json (מיגרציה 0021) ו-public.app_build_feed (מיגרציה 0016).
פורמט: true או false, בלי מירכאות.' where key = 'jev_apply_to_feed';
update public.app_settings set description = 'מה זה: Jev מחזיר לרמת החשיבות הסתברות לכל אחת משתי הרמות (חשוב, קריטי), וגם מדד ודאות בין 0 ל-1. ידיעה מסומנת "קריטי" רק כש-Jev אמר קריטי והוודאות לפחות הסף הזה. אחרת היא "חשוב".
על מה זה משפיע: אילו ידיעות מסומנות קריטיות במהדורה (ומוצגות גם למי שבחר "רק קריטיות").
איפה זה ממומש: שרת: public.app_parsed_item_json (מיגרציה 0021).
פורמט: מספר (אפשר עם נקודה עשרונית), בלי מירכאות, בין 0 ל-1. דוגמה: 0.5.' where key = 'jev_importance_min_confidence';
update public.app_settings set description = 'מה זה: לכל ידיעה Jev בוחר נושא ראשי אחד, הקרוב ביותר, כך שלכל ידיעה יש תמיד נושא. בנוסף, על כל נושא אחר הוא עונה כן/לא עם הסתברות בין 0 ל-1, והנושא מתווסף לידיעה אם ההסתברות לפחות הסף הזה. סף גבוה יותר נותן פחות נושאים נוספים.
על מה זה משפיע: אילו נושאים נוספים נשמרים לכל ידיעה (ההסתברויות של כל הנושאים נשמרות בכל מקרה).
איפה זה ממומש: שרת: supabase/functions/app-classify/index.ts (readAnswers).
פורמט: מספר (אפשר עם נקודה עשרונית), בלי מירכאות, בין 0.3 ל-0.99. דוגמה: 0.7.' where key = 'jev_topic_threshold';

CREATE OR REPLACE FUNCTION public.app_parsed_item_json(p_edition tamzit_editions, p_n integer, p_section text, p_subsection text, p_kind text, p_headline text, p_body text, p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lab as (   -- the Jev label of this text, when jev_apply_to_feed is on
    select l.topics, l.main_topic, l.importance, l.importance_confidence
    from public.app_item_labels l
    where p_kind = 'news' and public.app_setting_bool('jev_apply_to_feed', false)
      and l.text_hash = public.app_item_hash(public.app_lang_code(p_edition.language), p_headline, p_body)
      and l.status = 'ok'
  )
  select jsonb_build_object(
    'id', 'e' || p_edition.id || '-' || p_n,
    'topic_id', coalesce((select coalesce(lab.main_topic, lab.topics[1]) from lab),
                       public.app_topic_for(concat_ws(' / ', p_section, p_subsection))),
    'topic_name', coalesce(p_subsection, p_section),
    'section', p_section,
    'subsection', p_subsection,
    -- two levels: critical only when Jev says so with enough confidence; otherwise important (nothing is hidden)
    'level', case when p_edition.edition_type = 'special_update' then 'critical'
                 when exists (select 1 from lab where lab.importance = 'critical'
                              and lab.importance_confidence >= public.app_setting_num('jev_importance_min_confidence', 0.5))
                   then 'critical'
                 else 'important' end,
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
    -- all of the item's topics (the topic filter shows it when any of them was picked): Jev's, and the topic of the
    -- section the editors put it in
    || coalesce((select jsonb_build_object('topics', to_jsonb(array(
                   select distinct t
                   from unnest(lab.topics || public.app_topic_for(concat_ws(' / ', p_section, p_subsection))) t
                   where t is not null)))
                 from lab), '{}'::jsonb)
    -- pilot monitoring (jev_show_labels): what Jev said, as it said it, shown small under the item in the app
    || coalesce((select jsonb_build_object('ai', jsonb_build_object(
                   'topics', to_jsonb(lab.topics), 'importance', lab.importance,
                   'confidence', round(lab.importance_confidence, 2)))
                 from lab where public.app_setting_bool('jev_show_labels', false)), '{}'::jsonb);
$function$;

create or replace view public.app_item_labels_review with (security_invoker = true) as
select l.created_at, l.lang, l.item_id, l.section,
       public.app_topic_for(l.section) as section_topic,
       l.topics as jev_topics, l.importance as jev_importance, round(l.importance_confidence, 2) as confidence,
       l.headline, l.excerpt, l.topic_probs, l.importance_probs, l.model, l.status, l.error, l.main_topic
from public.app_item_labels l;
revoke all on public.app_item_labels_review from anon, authenticated;
