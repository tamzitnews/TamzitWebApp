-- Tamzit app: the message console lives inside the app, for the operators listed in console_admin_emails.
--
-- A web page cannot host it: Supabase serves every function and storage response with "content-security-policy:
-- default-src 'none'; sandbox" and as text/plain, so an HTML page served from there never runs. The operators already
-- carry the app and are signed in there, so the console is a screen in it: Settings → "הודעות לקוראים".
--
-- (a) app_me() gains "is_operator": whether this reader sees that screen.
-- (b) app_console_overview(): what the screen shows — how many devices would get a message now (by language, and how
--     many are skipped for Shabbat), and the last messages that were sent. Operators only.
-- Sending itself stays in the app-push edge function (it needs FCM), which admits the same operators.
-- Idempotent.

create or replace function public.app_console_overview(p_history int default 15) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_resting text[];
begin
  if v_uid is null or not public.app_is_console_admin(v_uid) then
    raise exception using errcode = 'P0001', message = 'not_an_operator';
  end if;
  select coalesce(array_agg(r.city_id), '{}') into v_resting
  from public.app_rest_periods r where now() between r.starts_at and r.ends_at;

  return jsonb_build_object(
    'devices', (select count(*) from public.app_devices),
    'by_language', (
      select coalesce(jsonb_object_agg(x.lang, x.n), '{}'::jsonb)
      from (select coalesce(p.language, 'unknown') as lang, count(*) as n
            from public.app_devices d left join public.user_preferences p on p.user_id = d.profile_id
            group by 1) x),
    'awake', (
      select count(*) from public.app_devices d left join public.user_preferences p on p.user_id = d.profile_id
      where not (coalesce(p.shabbat_city_id, 'jerusalem') = any(v_resting))),
    'resting', (
      select count(*) from public.app_devices d left join public.user_preferences p on p.user_id = d.profile_id
      where coalesce(p.shabbat_city_id, 'jerusalem') = any(v_resting)),
    'history', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]'::jsonb)
      from (select b.id, b.created_at, b.title, b.body, b.url, b.language, b.devices, b.sent
            from public.app_push_broadcasts b
            order by b.created_at desc
            limit least(greatest(coalesce(p_history, 15), 1), 50)) h)
  );
end;
$$;

revoke execute on function public.app_console_overview(int) from public, anon;
grant execute on function public.app_console_overview(int) to authenticated, service_role;

-- app_me, with "is_operator" added (everything else as in migration 0009).
create or replace function public.app_me() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prof public.user_preferences;
  v_plan jsonb;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'not_authenticated';
  end if;
  update public.user_preferences set last_seen_at = now() where user_id = v_uid returning * into v_prof;
  if not found then
    return jsonb_build_object('profile', null, 'is_premium', false, 'plan', 'free', 'family_role', null,
                              'unread_messages', 0, 'is_operator', false);
  end if;
  if v_prof.phone is not null then
    update public.app_family_members set status = 'joined', joined_at = now()
    where member_phone = v_prof.phone and status = 'invited';
  end if;
  v_plan := public.app_plan_info(v_uid);
  return jsonb_build_object(
    'profile', public.app_profile_json(v_prof),
    'is_premium', public.app_is_premium(v_uid),
    'plan', v_plan ->> 'plan',
    'family_role', v_plan -> 'family_role',
    'unread_messages', (select count(*) from public.app_messages m where m.profile_id = v_uid and m.read_at is null),
    'is_operator', public.app_is_console_admin(v_uid)
  );
end;
$$;
