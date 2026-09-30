-- Tamzit app: who sees weather, sports and critical items.
-- (a) Items whose main topic is in app_settings.topics_only_for_choosers (weather, sports) reach only readers who chose
--     that topic; their other topics (e.g. "world" on a Nepal flood item) no longer open them to other readers.
-- (b) Critical items (special updates, and items Jev marks critical with enough confidence) reach every reader,
--     whatever topics and level they chose (app_settings.critical_for_everyone, true). Before, (b) held without a
--     setting. Idempotent.

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('topics_only_for_choosers', '["weather", "sports"]'::jsonb, 'נושאים שמוצגים רק למי שבחר בהם', 'מה זה: ידיעה שהנושא הראשי שלה אחד מהנושאים ברשימה מוצגת רק לקוראים שבחרו בנושא הזה. הנושאים הנוספים שלה (למשל "עולם" בידיעה על שיטפונות בנפאל שהנושא הראשי שלה מזג אוויר) לא פותחים אותה לקוראים אחרים. ידיעה קריטית מוצגת לכולם בכל מקרה (critical_for_everyone). קורא שלא בחר אף נושא רואה הכול.
על מה זה משפיע: מי רואה ידיעות מזג אוויר וספורט.
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0022), בסינון לפי נושאים של המהדורה האישית. המזהים הם של app_topics.
פורמט: רשימה בסוגריים מרובעים של מזהי נושאים במירכאות כפולות. דוגמה: ["weather", "sports"].',
   'תוכן המהדורה', 'text_list', '{"max_items": 14}'::jsonb, '["weather", "sports"]'::jsonb, false, false, 355),
  ('critical_for_everyone', 'true'::jsonb, 'ידיעות קריטיות מוצגות לכולם', 'מה זה: true: ידיעה שמסומנת "קריטי" מוצגת לכל הקוראים, בלי קשר לנושאים ולרמת החשיבות שבחרו. למשל, עדכון על צונאמי שהנושא שלו מזג אוויר מוצג גם למי שלא בחר מזג אוויר. false: ידיעה קריטית עוברת את הסינון לפי נושאים כמו כל ידיעה (ועדיין מוצגת לכל מי שבחר את הנושא, בכל רמה). עדכונים מיוחדים מוצגים לכולם תמיד.
על מה זה משפיע: אם ידיעות קריטיות מגיעות לכולם.
איפה זה ממומש: שרת: public.app_build_feed (מיגרציה 0022). ידיעה קריטית היא עדכון מיוחד, או ידיעה ש-Jev סימן קריטית בוודאות של jev_importance_min_confidence לפחות.
פורמט: true או false, בלי מירכאות.',
   'תוכן המהדורה', 'bool', '{}'::jsonb, 'true'::jsonb, false, false, 356)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

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
  -- critical items reach every reader, whatever topics and level they chose (critical_for_everyone)
  v_critical_all boolean := public.app_setting_bool('critical_for_everyone', true);
  -- items whose main topic is one of these reach only readers who chose it (topics_only_for_choosers)
  v_strict text[] := public.app_setting_texts('topics_only_for_choosers', array['weather', 'sports']);
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
           or (its.level = 'critical' and v_critical_all)
           or ((its.topic_id is null or cardinality(v_topics) = 0 or its.topic_id = any(v_topics)
                or (not (its.topic_id = any(v_strict)) and coalesce(its.item -> 'topics', '[]'::jsonb) ?| v_topics))
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
