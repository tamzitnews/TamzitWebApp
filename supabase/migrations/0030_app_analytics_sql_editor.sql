-- Tamzit app: the usage numbers are also readable from the Supabase SQL editor.
--
-- app_analytics answers an operator signed in through the app (console_admin_emails). Run from the Supabase SQL
-- editor there is no signed-in reader at all (auth.uid() is null), so it refused, and the owner — who already has
-- every row in the project — could not get the numbers on a computer. Now a connection that is the project's own
-- (postgres / service_role / supabase_admin, i.e. the service key or the dashboard) may read them too.
--
--   select jsonb_pretty(public.app_analytics(30));
--
-- An ordinary reader's connection is unchanged: without a listed account it still raises not_an_operator.
-- Idempotent.

create or replace function public.app_analytics(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_days int := least(greatest(coalesce(p_days, 30), 1), 180);
  v_from timestamptz := now() - make_interval(days => v_days);
begin
  -- an operator in the app, or the project's own connection (the SQL editor, the service key)
  if v_uid is null then
    if current_user not in ('postgres', 'service_role', 'supabase_admin') then
      raise exception using errcode = 'P0001', message = 'not_an_operator';
    end if;
  elsif not public.app_is_console_admin(v_uid) then
    raise exception using errcode = 'P0001', message = 'not_an_operator';
  end if;

  return jsonb_build_object(
    'days', v_days,
    'generated_at', now(),

    -- how many people there are, and how many are still coming back
    'people', (
      with act as (
        select p.user_id, p.created_at,
               greatest(p.last_seen_at, (select max(e.created_at) from public.app_events e where e.profile_id = p.user_id)) as seen
        from public.user_preferences p
        where exists (select 1 from auth.users u where u.id = p.user_id)   -- app accounts; the service's older rows are not
      )
      select jsonb_build_object(
        'registered', (select count(*) from act),
        'legacy_profiles', (select count(*) from public.user_preferences p
                            where not exists (select 1 from auth.users u where u.id = p.user_id)),
        'with_device', (select count(distinct profile_id) from public.app_devices),
        'devices', (select count(*) from public.app_devices),
        'active_today', (select count(*) from act where seen >= now() - interval '1 day'),
        'active_7d', (select count(*) from act where seen >= now() - interval '7 days'),
        'active_30d', (select count(*) from act where seen >= now() - interval '30 days'),
        'new_7d', (select count(*) from act where created_at >= now() - interval '7 days'),
        'at_risk', (select count(*) from act where seen between now() - interval '14 days' and now() - interval '7 days'),
        'churned', (select count(*) from act where seen < now() - interval '14 days'),
        'never_opened', (select count(*) from act where seen is null))
    ),

    -- which version people are on
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object('version', v, 'build', b, 'devices', n) order by n desc), '[]'::jsonb)
      from (select coalesce(app_version, '—') as v, app_build as b, count(*) as n
            from public.app_devices group by 1, 2) x
    ),

    -- what happened in the window
    'events', (
      select coalesce(jsonb_object_agg(name, n), '{}'::jsonb)
      from (select name, count(*) as n from public.app_events where created_at >= v_from group by 1) x
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d::date, 'people', coalesce(p, 0), 'opens', coalesce(o, 0), 'editions', coalesce(r, 0)) order by d), '[]'::jsonb)
      from generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') d
      left join lateral (
        select count(distinct e.profile_id) as p,
               count(*) filter (where e.name = 'app_open') as o,
               count(*) filter (where e.name = 'edition_read') as r
        from public.app_events e
        where e.created_at >= d and e.created_at < d + interval '1 day') s on true
    ),
    'engagement', jsonb_build_object(
      'audio_plays', (select count(*) from public.app_events where name = 'audio_play' and created_at >= v_from),
      'audio_listeners', (select count(distinct profile_id) from public.app_events where name = 'audio_play' and created_at >= v_from),
      'ad_clicks', (select count(*) from public.app_events where name = 'ad_click' and created_at >= v_from),
      'ad_clickers', (select count(distinct profile_id) from public.app_events where name = 'ad_click' and created_at >= v_from),
      'saves', (select count(*) from public.app_events where name = 'item_save' and created_at >= v_from),
      'shares', (select count(*) from public.app_events where name = 'item_share' and created_at >= v_from),
      'searches', (select count(*) from public.app_events where name = 'search' and created_at >= v_from),
      'editions_read', (select count(*) from public.app_reads where read_at >= v_from),
      'minutes', (select round(coalesce(sum((props ->> 'seconds')::numeric), 0) / 60.0)
                  from public.app_events where name = 'session_end' and created_at >= v_from
                    and (props ->> 'seconds') ~ '^[0-9]+$'),
      'tour_done', (select count(distinct profile_id) from public.app_events where name = 'tour_done'),
      'tour_skip', (select count(distinct profile_id) from public.app_events where name = 'tour_skip')
    ),

    -- one row per reader, newest first
    'readers', (
      select coalesce(jsonb_agg(r order by r ->> 'seen' desc nulls last), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'name', coalesce(nullif(btrim(p.name), ''), '—'),
          'joined', p.created_at,
          'lang', p.language,
          'audience', p.audience,
          'plan', case when public.app_is_premium(p.user_id) then 'premium' else 'free' end,
          'devices', (select count(*) from public.app_devices d where d.profile_id = p.user_id),
          'version', (select d.app_version from public.app_devices d where d.profile_id = p.user_id
                      order by d.last_seen_at desc limit 1),
          'push', (select count(*) > 0 from public.app_devices d where d.profile_id = p.user_id),
          'seen', greatest(p.last_seen_at, (select max(e.created_at) from public.app_events e where e.profile_id = p.user_id)),
          'opens', (select count(*) from public.app_events e where e.profile_id = p.user_id and e.name = 'app_open' and e.created_at >= v_from),
          'editions', (select count(*) from public.app_reads a where a.profile_id = p.user_id and a.read_at >= v_from),
          'minutes', (select round(coalesce(sum((e.props ->> 'seconds')::numeric), 0) / 60.0)
                      from public.app_events e where e.profile_id = p.user_id and e.name = 'session_end'
                        and e.created_at >= v_from and (e.props ->> 'seconds') ~ '^[0-9]+$'),
          'audio', (select count(*) from public.app_events e where e.profile_id = p.user_id and e.name = 'audio_play' and e.created_at >= v_from),
          'ads', (select count(*) from public.app_events e where e.profile_id = p.user_id and e.name = 'ad_click' and e.created_at >= v_from),
          'saved', (select count(*) from public.app_saved_items si where si.profile_id = p.user_id)
        ) as r
        from public.user_preferences p
        where exists (select 1 from auth.users u where u.id = p.user_id)
        limit 500
      ) x
    )
  );
end;
$$;

revoke execute on function public.app_analytics(int) from public, anon;
grant execute on function public.app_analytics(int) to authenticated, service_role;
