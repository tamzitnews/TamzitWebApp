-- Tamzit app: on a winter Saturday (or holiday) night there are two Hebrew evening editions, and both reach the app.
--
-- What went wrong on 3.10.2026: the Motzei Shabbat edition went out at 19:44 ("*מהדורת מוצאי שבת א', …*") and the
-- regular evening edition at 21:11 ("*מהדורת ערב, מוצאי שבת, …*"). The engine logged neither, so the WhatsApp fallback
-- parked both. The first was written. The second was closed as 'engine_wrote_it' and never written: no edition in the
-- app, no notification. Both texts are time_slot 'ערב' (app_edition_of_text reads "מהדורת מוצאי שבת" as 'ערב', and the
-- engine's classifier writes 'ערב' for it too), and every check that tells one edition from another counted
-- (language, type, app_edition_slot, day). Until now that was right: a Motzei Shabbat edition replaced the evening
-- edition. The Editing Room's winter mode (its migration 0018) now sends both on the same night: Motzei Shabbat about
-- ten minutes after Shabbat ends, and the evening edition at 21:00 (English and French: only the evening edition, at
-- 21:45).
--
-- time_slot stays 'ערב' for both. A new value would not reach the engine, whose classifier only knows the five old
-- ones. An engine row and a WhatsApp row of the same Motzei Shabbat edition would then look like two editions, and it
-- would be written and pushed twice. Instead, the checks that tell editions apart now use app_edition_slot_key:
-- app_edition_slot, except that a Motzei Shabbat edition (by its name in the header, as app_edition_kind already reads
-- it) is its own slot, 'motzash'. Every other edition gets exactly the slot it had, so nothing changes on any other
-- day. On a summer Saturday the Motzei Shabbat edition is still the only Hebrew evening edition. It is now counted
-- under 'motzash' instead of 'evening', and is still one edition with one push. The slot that readers and pushes see
-- ('evening' in app_editions_window.slot, app_push_payload, app_edition_is_own, app_slot_hour_ok) does not change, so
-- the app and its builds in readers' hands need nothing new. They already show a 'motzash' edition by its kind.
--
-- Redefined, each copied from its latest definition with only that change:
-- (a) app_ingest_due_editions (0032): a parked edition is dropped only when that same edition (slot key) is there.
-- (b) app_tamzit_editions_push (0015): one push per language, track, slot key and day.
-- (c) app_editions_window (0009): the evening edition is not taken as a re-send of the Motzei Shabbat edition (newest
--     text wins). Otherwise the Motzei Shabbat edition would drop out of the archive once the evening edition arrives.
-- (d) app_edition_group (0009): the two editions are separate groups, so each has its own send time (app_edition_span),
--     and so its own audio and sponsor ad. Otherwise the evening edition would play the Motzei Shabbat recording.
-- (e) app_edition_ad (0015): its group and span are computed once instead of for every candidate ad (same result).
-- (c) and (d) read the name from app_edition_stats, which is written for every edition when it is saved. They parse
-- the text only when that row is missing.
-- Idempotent.

-- The slot an edition is told apart by. p_title: app_edition_title(main_text). plpgsql rather than sql: it runs for
-- every row the feed reads, and a sql function with its own search_path is planned again on every call.
create or replace function public.app_edition_slot_key(p_edition_type text, p_time_slot text, p_title text) returns text
language plpgsql immutable set search_path = public as $$
declare
  v_slot text := public.app_edition_slot(p_edition_type, p_time_slot);
begin
  if v_slot = 'evening'
     and coalesce(p_title, '') ~* '(מוצאי|motz|motsa|saturday night|samedi soir)'
     and coalesce(p_title, '') !~* '^(מהדורת ערב|evening edition|[ÉéEe]dition du soir)' then
    return 'motzash';
  end if;
  return v_slot;
end;
$$;

-- (a) From 0032; only the "already there" check changed (slot key instead of slot).
create or replace function public.app_ingest_due_editions() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id bigint;
  v_n int := 0;
  v_key text;
begin
  for r in
    select * from public.app_whapi_pending
    where done_at is null and due_at <= now()
    order by sent_at
    limit 20
    for update skip locked
  loop
    -- the engine (or an earlier pending row) wrote this edition in the meantime: nothing to do. On a winter Saturday
    -- night the Motzei Shabbat edition and the evening edition are two editions, though both are time_slot 'ערב'.
    v_key := public.app_edition_slot_key(r.edition_type, r.time_slot, public.app_edition_title(r.main_text));
    if exists (select 1 from public.tamzit_editions e
               where e.language = r.language and e.edition_type = r.edition_type and e.edition_date = r.edition_date
                 and public.app_edition_slot_key(e.edition_type, e.time_slot, public.app_edition_title(e.main_text))
                     = v_key) then
      update public.app_whapi_pending set done_at = now(), outcome = 'engine_wrote_it' where id = r.id;
      continue;
    end if;
    -- far too late to be worth showing as that edition (a day old)
    if r.sent_at < now() - interval '24 hours' then
      update public.app_whapi_pending set done_at = now(), outcome = 'too_late' where id = r.id;
      continue;
    end if;
    insert into public.tamzit_editions (created_at, edition_date, main_text, language, edition_type, time_slot)
    values (r.sent_at, r.edition_date, r.main_text, r.language, r.edition_type, r.time_slot)
    returning id into v_id;
    insert into public.app_whapi_editions (edition_id, message_id) values (v_id, r.message_id);
    if r.ad_text is not null and public.app_ad_element_for_caption(r.ad_text, coalesce(r.ad_at, r.sent_at)) is null then
      insert into public.tamzit_edition_elements (created_at, edition_id, element_type, content_text, position)
      values (coalesce(r.ad_at, r.sent_at), v_id, 'ad', r.ad_text, 0);
    end if;
    update public.app_whapi_pending set done_at = now(), outcome = 'written', edition_id = v_id where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- (b) From 0015; only the push key changed (slot key instead of slot). The name is read from the text itself: this
-- trigger runs before app_tamzit_editions_stats has written the edition's row.
create or replace function public.app_tamzit_editions_push() returns trigger
language plpgsql security definer set search_path = public as $$
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
               || public.app_edition_slot_key(new.edition_type, new.time_slot, public.app_edition_title(new.main_text))
               || ':' || coalesce(new.edition_date::text, '');
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
$$;

-- (c) From 0009; only the partitions changed (slot key instead of slot). The returned slot is the same as before.
create or replace function public.app_editions_window(p_lang text, p_from timestamptz, p_to timestamptz)
returns table (id bigint, published_at timestamptz, edition_date date, track text, slot text,
               edition_type text, time_slot text, main_text text)
language sql stable security definer set search_path = public as $$
  with e as (
    select t.id, t.created_at, t.edition_date, t.edition_type, t.time_slot, t.main_text,
           public.app_edition_track(t.edition_type) as track,
           public.app_edition_slot(t.edition_type, t.time_slot) as slot,
           public.app_edition_slot_key(t.edition_type, t.time_slot,
                                       coalesce(st.title, public.app_edition_title(t.main_text))) as slot_key,
           md5(t.main_text) as h
    from public.tamzit_editions t
    left join public.app_edition_stats st on st.edition_id = t.id
    where t.language = public.app_lang_name(p_lang)
      and t.edition_date between (p_from at time zone 'Asia/Jerusalem')::date - 1
                             and (p_to at time zone 'Asia/Jerusalem')::date + 1
  ),
  l as (
    select e.*, first_value(e.h) over (partition by e.edition_type, e.slot_key, e.edition_date
                                       order by e.created_at desc, e.id desc) as latest_h
    from e
  ),
  g as (
    select l.*, min(l.id) over w as rep_id, min(l.created_at) over w as first_at
    from l
    where l.track = 'special' or l.h = l.latest_h
    window w as (partition by l.edition_type, l.slot_key, l.edition_date, l.h)
  )
  select g.id, g.first_at, g.edition_date, g.track, g.slot, g.edition_type, g.time_slot, g.main_text
  from g
  where g.id = g.rep_id and g.first_at > p_from and g.first_at <= p_to and g.first_at <= now();
$$;

-- (d) From 0009; only the slot key condition (and the names it reads) added.
create or replace function public.app_edition_group(p_id bigint) returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(o.id), array[p_id])
  from public.tamzit_editions e
  join public.tamzit_editions o
    on o.language = e.language and o.edition_type = e.edition_type and o.time_slot = e.time_slot
   and o.edition_date = e.edition_date
   and (e.edition_type <> 'special_update' or md5(o.main_text) = md5(e.main_text))
  left join public.app_edition_stats es on es.edition_id = e.id
  left join public.app_edition_stats os on os.edition_id = o.id
  where e.id = p_id
    -- the Motzei Shabbat and the evening edition of a winter Saturday night are both time_slot 'ערב'
    and public.app_edition_slot_key(o.edition_type, o.time_slot, coalesce(os.title, public.app_edition_title(o.main_text)))
        = public.app_edition_slot_key(e.edition_type, e.time_slot, coalesce(es.title, public.app_edition_title(e.main_text)));
$$;

-- (e) From 0015; only "materialized" added. The edition's group and span were evaluated again for every candidate ad
-- row; they are one row each, so they are now computed once. Same result (checked on every Hebrew edition); without
-- this, the slot key in (d) would make each ad lookup slower than before.
create or replace function public.app_edition_ad(p_edition_id bigint, p_lang text) returns bigint
language sql stable security definer set search_path = public as $$
  with g as materialized (select public.app_edition_group(p_edition_id) as ids),
  s as materialized (select * from public.app_edition_span(p_edition_id))
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
$$;

revoke execute on function public.app_edition_slot_key(text, text, text) from public, anon, authenticated;
grant execute on function public.app_edition_slot_key(text, text, text) to service_role;
