-- Tamzit app: Jev labels visible in the app during the pilot.
-- With app_settings.jev_show_labels (and jev_apply_to_feed) on, every parsed news item that has a Jev label carries
-- ai = { topics: Jev's topics (most likely first), importance: Jev's level, confidence } and the app shows it in a
-- small line under the item, so the pilot readers and the editors can watch the classification. Display only.
-- Idempotent.

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('jev_show_labels', 'true'::jsonb, 'הצגת הסיווג של Jev באפליקציה (פיילוט)', 'מה זה: כש-true (וגם jev_apply_to_feed פעיל), כל ידיעה במהדורה מגיעה לאפליקציה עם מה ש-Jev אמר עליה: הנושאים שמצא, רמת החשיבות ומידת הוודאות בה. האפליקציה מציגה את זה בשורה קטנה מתחת לידיעה, למשל "Jev · ביטחון, עולם · חשוב · ודאות 85%". מיועד לפיילוט, כדי לנטר את הסיווג מתוך האפליקציה. לפני פתיחה לקהל מכבים.
על מה זה משפיע: רק על התצוגה. מה שמסונן ואיזו רמה מוצגת לא משתנים.
איפה זה ממומש: שרת: public.app_parsed_item_json (מיגרציה 0018), השדה ai של הידיעה. אפליקציה: mobile/src/components/news/NewsItem.tsx (JevLine).
פורמט: true או false, בלי מירכאות.',
   'סיווג ידיעות (Jev)', 'bool', '{}'::jsonb, 'false'::jsonb, false, false, 1015)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

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
