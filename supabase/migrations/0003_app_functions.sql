-- Tamzit app: helper functions and RPCs (docs/api-contract.md, "RPCs").
-- All RPCs are security definer with search_path = public, read auth.uid(), and raise
-- `raise exception using errcode = 'P0001', message = '<code>'` so the client can read error.message.
-- Idempotent: create or replace.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------

create or replace function public.app_setting_text(p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select value #>> '{}' from public.app_settings where key = p_key;
$$;

create or replace function public.app_setting_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default);
$$;

-- Phone normalisation (same rules as the edge functions):
-- 05X-XXXXXXX, 5XXXXXXXX, 9725XXXXXXXX, +9725XXXXXXXX, 00972..., +972-05X... -> +9725XXXXXXXX.
-- Other international numbers (+ or 00 prefix) are kept as E.164. Anything else -> null.
create or replace function public.app_normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_plus boolean;
  v_d text;
  v_rest text;
begin
  if p_phone is null then
    return null;
  end if;
  v_plus := btrim(p_phone) like '+%';
  v_d := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if not v_plus and v_d like '00%' then
    v_plus := true;
    v_d := substr(v_d, 3);
  end if;
  if v_plus or v_d like '972%' then
    if v_d like '972%' then
      v_rest := substr(v_d, 4);
      if v_rest like '0%' then
        v_rest := substr(v_rest, 2);
      end if;
      if v_rest ~ '^5[0-9]{8}$' then
        return '+972' || v_rest;
      end if;
      return null;
    end if;
    if v_plus and v_d ~ '^[1-9][0-9]{6,14}$' then
      return '+' || v_d;
    end if;
    return null;
  end if;
  if v_d ~ '^05[0-9]{8}$' then
    return '+972' || substr(v_d, 2);
  end if;
  if v_d ~ '^5[0-9]{8}$' then
    return '+972' || v_d;
  end if;
  return null;
end;
$$;

create or replace function public.app_word_count(p_text text)
returns int
language sql
immutable
set search_path = public
as $$
  select case when p_text is null or btrim(p_text) = '' then 0
              else cardinality(regexp_split_to_array(btrim(p_text), '\s+')) end;
$$;

-- Premium: an active subscription for the profile's phone, or membership (invited / joined) in a
-- family whose owner holds an active 'family' subscription.
create or replace function public.app_is_premium(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (select phone from public.app_profiles where id = p_uid)
  select
    exists (
      select 1 from public.app_subscriptions s join me on s.phone = me.phone
      where s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    )
    or exists (
      select 1
      from public.app_family_members fm
      join me on fm.member_phone = me.phone
      join public.app_profiles o on o.id = fm.owner_id
      join public.app_subscriptions s on s.phone = o.phone and s.plan = 'family'
      where fm.status in ('joined', 'invited')
        and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    );
$$;

-- { plan: 'free'|'premium'|'family', family_role: 'owner'|'member'|null }
create or replace function public.app_plan_info(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select phone from public.app_profiles where id = p_uid),
  own as (
    select
      bool_or(s.plan = 'family') as has_family,
      bool_or(s.plan = 'premium') as has_premium
    from public.app_subscriptions s join me on s.phone = me.phone
    where s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
  ),
  member as (
    select exists (
      select 1
      from public.app_family_members fm
      join me on fm.member_phone = me.phone
      join public.app_profiles o on o.id = fm.owner_id
      join public.app_subscriptions s on s.phone = o.phone and s.plan = 'family'
      where fm.status in ('joined', 'invited')
        and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())
    ) as is_member
  )
  select jsonb_build_object(
    'plan', case when coalesce(own.has_family, false) then 'family'
                 when coalesce(own.has_premium, false) then 'premium'
                 when member.is_member then 'family'
                 else 'free' end,
    'family_role', case when coalesce(own.has_family, false) then 'owner'
                        when member.is_member then 'member'
                        else null end
  )
  from own, member;
$$;

-- Version choice: the reader's language (optionally any language), then their audience, then their
-- style, then 'informative', then any style.
create or replace function public.app_pick_version(
  p_item_id uuid, p_lang text, p_aud text, p_style text, p_any_language boolean default false
)
returns table (headline text, body text, style text, language text)
language sql
stable
security definer
set search_path = public
as $$
  select v.headline, v.body, v.style, v.language
  from public.app_item_versions v
  where v.item_id = p_item_id and (v.language = p_lang or p_any_language)
  order by (v.language = p_lang) desc,
           (v.audience = p_aud) desc,
           (v.style = p_style) desc,
           (v.style = 'informative') desc,
           (v.audience = 'general') desc,
           v.language, v.style
  limit 1;
$$;

-- One FeedItem (see the contract), or null when the item has no usable version.
create or replace function public.app_item_json(
  p_item_id uuid, p_lang text, p_aud text, p_style text, p_uid uuid, p_any_language boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id,
    'topic_id', i.topic_id,
    'topic_name', case p_lang when 'en' then t.name_en when 'fr' then t.name_fr else t.name_he end,
    'level', i.level,
    'kind', i.kind,
    'community_id', i.community_id,
    'community_name', case p_lang when 'en' then c.name_en when 'fr' then c.name_fr else c.name_he end,
    'headline', v.headline,
    'body', v.body,
    'style', v.style,
    'published_at', i.published_at,
    'corrected_at', i.corrected_at,
    'saved', exists (select 1 from public.app_saved_items s where s.profile_id = p_uid and s.item_id = i.id)
  )
  from public.app_items i
  cross join lateral public.app_pick_version(i.id, p_lang, p_aud, p_style, p_any_language) v
  left join public.app_topics t on t.id = i.topic_id
  left join public.app_communities c on c.id = i.community_id
  where i.id = p_item_id;
$$;

-- Audio for a feed: an audio row linked to p_edition_id first, otherwise the latest published audio
-- for language + audience in (p_from, p_to], preferring kind 'edition'.
create or replace function public.app_pick_audio(
  p_lang text, p_aud text, p_from timestamptz, p_to timestamptz, p_edition_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'title', a.title, 'audio_url', a.audio_url,
    'duration_sec', a.duration_sec, 'published_at', a.published_at
  )
  from public.app_audio a
  where a.status = 'published' and a.language = p_lang and a.audience = p_aud and a.published_at <= now()
    and ((p_edition_id is not null and a.edition_id = p_edition_id)
         or (a.published_at > p_from and a.published_at <= p_to))
  order by (p_edition_id is not null and a.edition_id is not distinct from p_edition_id) desc,
           (a.kind = 'edition') desc,
           a.published_at desc
  limit 1;
$$;

-- Builds the Feed JSON.
--   p_editions : regular (non-special) editions whose items feed `items`, `community`, `good_news`
--   p_specials : special editions whose items feed `special`
--   p_filter   : apply the profile filter (critical always; topics; level_filter) and the max_items cap
create or replace function public.app_build_feed(
  p_uid uuid,
  p_lang text,
  p_aud text,
  p_from timestamptz,
  p_to timestamptz,
  p_editions uuid[],
  p_specials uuid[],
  p_filter boolean,
  p_title text,
  p_audio_from timestamptz,
  p_audio_to timestamptz,
  p_audio_edition uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles;
  v_premium boolean := public.app_is_premium(p_uid);
  v_max int := public.app_setting_int('max_items', 10);
  v_topics text[];
  v_min_rank int;
  v_communities text[];
  v_style text;
  v_items jsonb;
  v_special jsonb;
  v_community jsonb;
  v_good jsonb;
  v_ad jsonb;
  v_audio jsonb;
  v_types jsonb;
  v_words int;
  v_all uuid[] := coalesce(p_editions, '{}') || coalesce(p_specials, '{}');
begin
  select * into v_prof from public.app_profiles where id = p_uid;
  v_topics := coalesce(v_prof.topics, '{}');
  v_min_rank := public.app_level_rank(coalesce(v_prof.level_filter, 'general'));
  v_communities := coalesce(v_prof.communities, '{}');
  v_style := coalesce(v_prof.style, 'calm');

  -- items: kind 'news' of the regular editions, not repeated in `special`
  with cand as (
    select i.id, i.level, i.topic_id, i.published_at, min(ei.position) as pos
    from public.app_edition_items ei
    join public.app_items i on i.id = ei.item_id
    where ei.edition_id = any(coalesce(p_editions, '{}'))
      and i.status = 'published' and i.kind = 'news'
      and not exists (
        select 1 from public.app_edition_items se
        where se.edition_id = any(coalesce(p_specials, '{}')) and se.item_id = i.id
      )
    group by i.id, i.level, i.topic_id, i.published_at
  ),
  filt as (
    select c.*, public.app_item_json(c.id, p_lang, p_aud, v_style, p_uid) as j
    from cand c
    where not p_filter
       or c.level = 'critical'
       or ((cardinality(v_topics) = 0 or c.topic_id = any(v_topics))
           and public.app_level_rank(c.level) >= v_min_rank)
  ),
  ranked as (
    select f.j, row_number() over (
      order by public.app_level_rank(f.level) desc, f.published_at desc, f.pos, f.id
    ) as rn
    from filt f
    where f.j is not null
  )
  select coalesce(jsonb_agg(r.j order by r.rn), '[]'::jsonb) into v_items
  from ranked r
  where not p_filter or r.rn <= v_max;

  -- special: items of the special editions (never filtered)
  with cand as (
    select i.id, i.level, i.published_at, min(ei.position) as pos
    from public.app_edition_items ei
    join public.app_items i on i.id = ei.item_id
    where ei.edition_id = any(coalesce(p_specials, '{}')) and i.status = 'published'
    group by i.id, i.level, i.published_at
  ),
  js as (
    select public.app_item_json(c.id, p_lang, p_aud, v_style, p_uid) as j,
           row_number() over (order by public.app_level_rank(c.level) desc, c.published_at desc, c.pos, c.id) as rn
    from cand c
  )
  select coalesce(jsonb_agg(js.j order by js.rn), '[]'::jsonb) into v_special from js where js.j is not null;

  -- community: kind 'community' for the reader's communities, in the editions or published in the window
  with cand as (
    select i.id, i.community_id, i.published_at
    from public.app_items i
    where i.kind = 'community' and i.status = 'published'
      and i.community_id = any(v_communities)
      and i.published_at <= now()
      and (exists (select 1 from public.app_edition_items ei
                   where ei.item_id = i.id and ei.edition_id = any(coalesce(p_editions, '{}')))
           or (i.published_at > p_from and i.published_at <= p_to))
  ),
  js as (
    select c.community_id, c.published_at,
           public.app_item_json(c.id, p_lang, p_aud, v_style, p_uid) as j
    from cand c
  ),
  per as (
    select js.*, row_number() over (partition by js.community_id order by js.published_at desc) as rn
    from js where js.j is not null
  )
  select coalesce(jsonb_agg(per.j order by array_position(v_communities, per.community_id), per.published_at desc),
                  '[]'::jsonb)
  into v_community
  from per where per.rn <= 3;

  -- good_news: the latest in the editions / window; otherwise the latest of the previous 48 hours
  select j into v_good
  from (
    select public.app_item_json(i.id, p_lang, p_aud, v_style, p_uid) as j,
           exists (select 1 from public.app_edition_items ei
                   where ei.item_id = i.id and ei.edition_id = any(v_all)) as in_editions,
           i.published_at
    from public.app_items i
    where i.kind = 'good_news' and i.status = 'published' and i.published_at <= now()
      and (exists (select 1 from public.app_edition_items ei
                   where ei.item_id = i.id and ei.edition_id = any(v_all))
           or (i.published_at > least(p_from, p_to - interval '48 hours') and i.published_at <= p_to))
  ) g
  where g.j is not null
  order by g.in_editions desc, g.published_at desc
  limit 1;

  -- ad: free readers only; active, in its date range, matching language + audience; weighted random
  if not v_premium then
    select jsonb_build_object('id', a.id, 'sponsor', a.sponsor, 'body', a.body, 'link_url', a.link_url)
    into v_ad
    from public.app_ads a
    where a.active and a.language = p_lang and a.audience = p_aud
      and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
      and (a.edition_id is null or a.edition_id = any(v_all))
    order by (a.edition_id is not null) desc, -ln(1 - random()) / a.weight
    limit 1;
  end if;

  v_audio := public.app_pick_audio(p_lang, p_aud, p_audio_from, p_audio_to, p_audio_edition);

  -- edition types, newest first (regular editions; the special ones when there are no regular ones)
  select coalesce(jsonb_agg(x.edition_type order by x.mx desc), '[]'::jsonb) into v_types
  from (
    select e.edition_type, max(e.published_at) as mx
    from public.app_editions e
    where e.id = any(case when cardinality(coalesce(p_editions, '{}')) > 0 then p_editions else p_specials end)
    group by e.edition_type
  ) x;

  select coalesce(sum(public.app_word_count(e ->> 'headline') + public.app_word_count(e ->> 'body')), 0)
  into v_words
  from jsonb_array_elements(v_items || v_special || v_community
                            || case when v_good is null then '[]'::jsonb else jsonb_build_array(v_good) end) e;

  return jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'edition_types', v_types,
    'title', p_title,
    'items', v_items,
    'special', v_special,
    'community', v_community,
    'good_news', v_good,
    'ad', v_ad,
    'audio', v_audio,
    'minutes', greatest(1, ceil(v_words / 180.0)::int),
    'is_premium', v_premium
  );
end;
$$;

-- Current user id or 'not_authenticated'; profile or 'no_profile'.
create or replace function public.app_require_profile()
returns public.app_profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.app_profiles;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  select * into v_prof from public.app_profiles where id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'no_profile';
  end if;
  return v_prof;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.app_me()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.app_profiles;
  v_plan jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  update public.app_profiles set last_seen_at = now() where id = v_uid returning * into v_prof;
  if not found then
    return jsonb_build_object('profile', null, 'is_premium', false, 'plan', 'free',
                              'family_role', null, 'unread_messages', 0);
  end if;
  -- an invited family member joins on first use
  update public.app_family_members set status = 'joined', joined_at = now()
  where member_phone = v_prof.phone and status = 'invited';

  v_plan := public.app_plan_info(v_uid);
  return jsonb_build_object(
    'profile', to_jsonb(v_prof),
    'is_premium', public.app_is_premium(v_uid),
    'plan', v_plan ->> 'plan',
    'family_role', v_plan -> 'family_role',
    'unread_messages', (select count(*) from public.app_messages m where m.profile_id = v_uid and m.read_at is null)
  );
end;
$$;

create or replace function public.app_personal_edition(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_to timestamptz := coalesce(p_to, now());
  v_from timestamptz := coalesce(p_from, coalesce(p_to, now()) - interval '24 hours');
  v_days int := public.app_setting_int('free_archive_days', 7);
  v_regular uuid[];
  v_specials uuid[];
  v_title text;
begin
  -- 10 minutes of grace for client clocks
  if v_from < now() - make_interval(days => v_days) - interval '10 minutes'
     and not public.app_is_premium(v_prof.id) then
    raise exception using errcode = 'P0001', message = 'archive_locked';
  end if;

  select coalesce(array_agg(e.id order by e.published_at desc) filter (where e.edition_type <> 'special'), '{}'),
         coalesce(array_agg(e.id order by e.published_at desc) filter (where e.edition_type = 'special'), '{}')
  into v_regular, v_specials
  from public.app_editions e
  where e.status = 'published' and e.language = v_prof.language and e.audience = v_prof.audience
    and e.published_at > v_from and e.published_at <= v_to and e.published_at <= now();

  if cardinality(v_regular) = 1 then
    select e.title into v_title from public.app_editions e where e.id = v_regular[1];
  end if;

  return public.app_build_feed(
    v_prof.id, v_prof.language, v_prof.audience, v_from, v_to, v_regular, v_specials, true, v_title,
    least(v_from, v_to - interval '24 hours'), v_to, null
  );
end;
$$;

create or replace function public.app_edition_view(p_edition_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_days int := public.app_setting_int('free_archive_days', 7);
  v_ed public.app_editions;
  v_prev timestamptz;
  v_from timestamptz;
begin
  select * into v_ed from public.app_editions e
  where e.id = p_edition_id and e.status = 'published' and e.published_at <= now();
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if v_ed.published_at < now() - make_interval(days => v_days)
     and not public.app_is_premium(v_prof.id) then
    raise exception using errcode = 'P0001', message = 'archive_locked';
  end if;

  select max(e.published_at) into v_prev
  from public.app_editions e
  where e.language = v_ed.language and e.audience = v_ed.audience and e.status = 'published'
    and e.edition_type <> 'special' and e.published_at < v_ed.published_at;
  v_from := greatest(coalesce(v_prev, v_ed.published_at - interval '24 hours'), v_ed.published_at - interval '72 hours');

  return public.app_build_feed(
    v_prof.id, v_ed.language, v_ed.audience, v_from, v_ed.published_at,
    case when v_ed.edition_type = 'special' then '{}'::uuid[] else array[v_ed.id] end,
    case when v_ed.edition_type = 'special' then array[v_ed.id] else '{}'::uuid[] end,
    false, v_ed.title,
    v_ed.published_at - interval '24 hours', v_ed.published_at, v_ed.id
  );
end;
$$;

create or replace function public.app_archive(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_premium boolean := public.app_is_premium(v_prof.id);
  v_free int := public.app_setting_int('free_archive_days', 7);
  v_days int := least(greatest(coalesce(p_days, 30), 1), 3650);
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'edition_type', e.edition_type,
           'title', e.title,
           'published_at', e.published_at,
           'item_count', (select count(*) from public.app_edition_items ei
                          join public.app_items i on i.id = ei.item_id
                          where ei.edition_id = e.id and i.status = 'published' and i.kind = 'news')::int,
           'has_audio', exists (select 1 from public.app_audio a
                                where a.status = 'published' and a.language = e.language
                                  and a.audience = e.audience and a.published_at <= now()
                                  and (a.edition_id = e.id
                                       or (a.published_at > e.published_at - interval '24 hours'
                                           and a.published_at <= e.published_at))),
           'read', exists (select 1 from public.app_reads r
                           where r.profile_id = v_prof.id and r.edition_key = e.id::text),
           'locked', (not v_premium and e.published_at < now() - make_interval(days => v_free))
         ) order by e.published_at desc), '[]'::jsonb)
  into v_out
  from public.app_editions e
  where e.status = 'published' and e.language = v_prof.language and e.audience = v_prof.audience
    and e.published_at <= now() and e.published_at > now() - make_interval(days => v_days);
  return v_out;
end;
$$;

create or replace function public.app_search(p_query text, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_q text := btrim(coalesce(p_query, ''));
  v_pat text;
  v_out jsonb;
begin
  if not public.app_is_premium(v_prof.id) then
    raise exception using errcode = 'P0001', message = 'premium_required';
  end if;
  if length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select coalesce(jsonb_agg(x.j order by x.published_at desc), '[]'::jsonb) into v_out
  from (
    select public.app_item_json(i.id, v_prof.language, v_prof.audience, v_prof.style, v_prof.id) as j, i.published_at
    from public.app_items i
    where i.status = 'published' and i.published_at <= now()
      and exists (select 1 from public.app_item_versions v
                  where v.item_id = i.id and v.language = v_prof.language
                    and (v.headline ilike v_pat or v.body ilike v_pat))
    order by i.published_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) x
  where x.j is not null;
  return v_out;
end;
$$;

create or replace function public.app_saved()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.saved_at desc), '[]'::jsonb) into v_out
  from (
    select public.app_item_json(i.id, v_prof.language, v_prof.audience, v_prof.style, v_prof.id, true) as j,
           s.created_at as saved_at
    from public.app_saved_items s
    join public.app_items i on i.id = s.item_id
    where s.profile_id = v_prof.id and i.status = 'published'
  ) x
  where x.j is not null;
  return v_out;
end;
$$;

create or replace function public.app_toggle_save(p_item_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
begin
  delete from public.app_saved_items where profile_id = v_prof.id and item_id = p_item_id;
  if found then
    return false;
  end if;
  if not exists (select 1 from public.app_items i where i.id = p_item_id and i.status = 'published') then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  insert into public.app_saved_items (profile_id, item_id) values (v_prof.id, p_item_id)
  on conflict do nothing;
  return true;
end;
$$;

create or replace function public.app_mark_read(p_edition_key text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
begin
  if p_edition_key is null or length(p_edition_key) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_reads (profile_id, edition_key, read_at) values (v_prof.id, p_edition_key, now())
  on conflict (profile_id, edition_key) do update set read_at = excluded.read_at;
end;
$$;

create or replace function public.app_submit_feedback(p_item_id uuid, p_kind text, p_message text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_id uuid;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if p_kind is null or p_kind not in ('helpful', 'not_helpful', 'error', 'question') then
    raise exception using errcode = 'P0001', message = 'invalid_kind';
  end if;
  if p_item_id is not null and not exists (select 1 from public.app_items where id = p_item_id) then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
  if v_msg is not null and length(v_msg) > 4000 then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_feedback (profile_id, item_id, kind, message)
  values (v_prof.id, p_item_id, p_kind, v_msg)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_update_profile(p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_allowed constant text[] := array[
    'full_name', 'birth_year', 'city', 'language', 'audience', 'frequency', 'slot_times', 'level_filter',
    'style', 'topics', 'communities', 'special_push', 'edition_push', 'headline_in_push', 'text_scale',
    'theme', 'shabbat_city_id', 'onboarded'
  ];
  v_patch jsonb;
  v_new public.app_profiles;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
  from jsonb_each(p_patch) where key = any(v_allowed);

  begin
    v_new := jsonb_populate_record(v_prof, v_patch);
    -- a new frequency without explicit slot times gets the default times
    if v_patch ? 'frequency' and not v_patch ? 'slot_times'
       and cardinality(v_new.slot_times) is distinct from v_new.frequency then
      v_new.slot_times := case v_new.frequency
        when 1 then array['20:00'] when 2 then array['07:30', '20:00'] else array['07:30', '13:00', '20:00'] end;
    end if;
    v_new.full_name := btrim(v_new.full_name);

    update public.app_profiles set
      full_name = v_new.full_name, birth_year = v_new.birth_year, city = v_new.city,
      language = v_new.language, audience = v_new.audience, frequency = v_new.frequency,
      slot_times = v_new.slot_times, level_filter = v_new.level_filter, style = v_new.style,
      topics = coalesce(v_new.topics, '{}'), communities = coalesce(v_new.communities, '{}'),
      special_push = v_new.special_push, edition_push = v_new.edition_push,
      headline_in_push = v_new.headline_in_push, text_scale = v_new.text_scale, theme = v_new.theme,
      shabbat_city_id = v_new.shabbat_city_id, onboarded = v_new.onboarded
    where id = v_prof.id
    returning * into v_new;
  exception
    when data_exception or integrity_constraint_violation then
      raise exception using errcode = 'P0001', message = 'invalid_value', detail = sqlerrm;
  end;
  return to_jsonb(v_new);
end;
$$;

create or replace function public.app_family_invite(p_phone text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_phone text := public.app_normalize_phone(p_phone);
  v_row public.app_family_members;
begin
  if coalesce(public.app_plan_info(v_prof.id) ->> 'family_role', '') <> 'owner' then
    raise exception using errcode = 'P0001', message = 'not_family_owner';
  end if;
  if v_phone is null or v_phone = v_prof.phone then
    raise exception using errcode = 'P0001', message = 'invalid_phone';
  end if;
  insert into public.app_family_members as m (owner_id, member_phone, member_name, status, invited_at)
  values (v_prof.id, v_phone, nullif(btrim(coalesce(p_name, '')), ''), 'invited', now())
  on conflict (owner_id, member_phone) do update set
    member_name = coalesce(excluded.member_name, m.member_name),
    status = case when m.status = 'removed' then 'invited' else m.status end,
    invited_at = case when m.status = 'removed' then now() else m.invited_at end,
    joined_at = case when m.status = 'removed' then null else m.joined_at end
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.app_family_remove(p_phone text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_phone text := public.app_normalize_phone(p_phone);
begin
  if coalesce(public.app_plan_info(v_prof.id) ->> 'family_role', '') <> 'owner'
     and not exists (select 1 from public.app_family_members where owner_id = v_prof.id) then
    raise exception using errcode = 'P0001', message = 'not_family_owner';
  end if;
  update public.app_family_members set status = 'removed'
  where owner_id = v_prof.id and member_phone = coalesce(v_phone, p_phone);
  if not found then
    raise exception using errcode = 'P0001', message = 'not_found';
  end if;
end;
$$;

create or replace function public.app_register_device(p_token text, p_platform text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
begin
  if p_platform is null or p_platform not in ('android', 'ios') then
    raise exception using errcode = 'P0001', message = 'invalid_platform';
  end if;
  if p_token is null or length(btrim(p_token)) not between 1 and 4096 then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_devices (profile_id, push_token, platform)
  values (v_prof.id, btrim(p_token), p_platform)
  on conflict (push_token) do update set
    profile_id = excluded.profile_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

create or replace function public.app_record_donation(p_amount numeric, p_frequency text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_prof public.app_profiles := public.app_require_profile();
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception using errcode = 'P0001', message = 'invalid_amount';
  end if;
  if p_frequency is null or p_frequency not in ('once', 'monthly') then
    raise exception using errcode = 'P0001', message = 'invalid_value';
  end if;
  insert into public.app_donations (profile_id, amount, frequency) values (v_prof.id, p_amount, p_frequency)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges
-- ---------------------------------------------------------------------------

-- Internal helpers: server side only.
revoke execute on function
  public.app_setting_text(text),
  public.app_setting_int(text, int),
  public.app_normalize_phone(text),
  public.app_word_count(text),
  public.app_level_rank(text),
  public.app_is_premium(uuid),
  public.app_plan_info(uuid),
  public.app_pick_version(uuid, text, text, text, boolean),
  public.app_item_json(uuid, text, text, text, uuid, boolean),
  public.app_pick_audio(text, text, timestamptz, timestamptz, uuid),
  public.app_build_feed(uuid, text, text, timestamptz, timestamptz, uuid[], uuid[], boolean, text, timestamptz, timestamptz, uuid),
  public.app_require_profile()
from public, anon, authenticated;

grant execute on function
  public.app_setting_text(text),
  public.app_setting_int(text, int),
  public.app_normalize_phone(text),
  public.app_is_premium(uuid),
  public.app_plan_info(uuid)
to service_role;

-- Client RPCs: signed-in users only.
revoke execute on function
  public.app_me(),
  public.app_personal_edition(timestamptz, timestamptz),
  public.app_edition_view(uuid),
  public.app_archive(int),
  public.app_search(text, int),
  public.app_saved(),
  public.app_toggle_save(uuid),
  public.app_mark_read(text),
  public.app_submit_feedback(uuid, text, text),
  public.app_update_profile(jsonb),
  public.app_family_invite(text, text),
  public.app_family_remove(text),
  public.app_register_device(text, text),
  public.app_record_donation(numeric, text)
from public, anon;

grant execute on function
  public.app_me(),
  public.app_personal_edition(timestamptz, timestamptz),
  public.app_edition_view(uuid),
  public.app_archive(int),
  public.app_search(text, int),
  public.app_saved(),
  public.app_toggle_save(uuid),
  public.app_mark_read(text),
  public.app_submit_feedback(uuid, text, text),
  public.app_update_profile(jsonb),
  public.app_family_invite(text, text),
  public.app_family_remove(text),
  public.app_register_device(text, text),
  public.app_record_donation(numeric, text)
to authenticated, service_role;
