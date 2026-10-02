-- Tamzit app: the sponsor ad waits together with its edition.
--
-- 0031 made an edition seen on WhatsApp wait for the engine (whatsapp_edition_delay_minutes, 20) instead of being
-- written the moment it arrived. The sponsor message ("> המהדורה בחסות: …") follows the edition by a minute or two,
-- and app_ingest_ad only knew how to hang it on an edition that was already written — so from 0031 on, an edition
-- the engine never logged was written twenty minutes later without its ad, and the ad was lost.
--
-- The ad now waits on the same pending row and is written together with the edition. When the engine wrote the
-- edition in the meantime, nothing is written here: the engine logs its own ad element.
-- Idempotent.

alter table public.app_whapi_pending add column if not exists ad_text text;
alter table public.app_whapi_pending add column if not exists ad_at   timestamptz;

-- The sponsor message of an edition that came from WhatsApp. Writes the ad element when that edition already
-- exists here (element_id), and otherwise, while the edition is still waiting for the engine, keeps the ad on the
-- pending row (parked_for) so that app_ingest_due_editions writes the two together.
drop function if exists public.app_ingest_ad(text, timestamptz);
create or replace function public.app_ingest_ad(p_text text, p_at timestamptz,
                                                out element_id bigint, out parked_for bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(replace(coalesce(p_text, ''), E'\r', ''));
  v_at timestamptz := least(coalesce(p_at, now()), now());
  v_lang text := coalesce(public.app_lang_name(public.app_text_lang(v_text)), 'hebrew');
  v_edition bigint;
begin
  element_id := null;
  parked_for := null;
  if not public.app_setting_bool('whatsapp_editions_fallback', true)
     or v_text !~* '^>[[:space:]*_]*(המהדורה בחסות|this edition is sponsored|sponsored by|[ÉéEe]dition parrain)' then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('app_ingest_ad:' || md5(v_text)));
  if public.app_ad_element_for_caption(v_text, v_at) is not null then
    return;
  end if;
  -- the edition being sent: one written here, started in the last half hour (the sponsor message follows it)
  select e.id into v_edition
  from public.app_whapi_editions w join public.tamzit_editions e on e.id = w.edition_id
  where e.created_at between v_at - interval '30 minutes' and v_at + interval '2 minutes'
  order by (e.language = v_lang) desc, e.created_at desc
  limit 1;
  if v_edition is not null then
    insert into public.tamzit_edition_elements (created_at, edition_id, element_type, content_text, position)
    values (v_at, v_edition, 'ad', v_text, 0)
    returning id into element_id;
    return;
  end if;
  -- no such edition: it may still be waiting for the engine, and then the ad waits with it
  update public.app_whapi_pending p set ad_text = v_text, ad_at = v_at
   where p.id = (select q.id from public.app_whapi_pending q
                  where q.done_at is null and q.ad_text is null
                    and q.sent_at between v_at - interval '30 minutes' and v_at + interval '2 minutes'
                  order by (q.language = v_lang) desc, q.sent_at desc
                  limit 1)
  returning p.id into parked_for;
end;
$$;

-- Writes the editions whose wait is over and which the engine never wrote, each with the sponsor ad that waited
-- with it. Returns how many editions were written.
create or replace function public.app_ingest_due_editions() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id bigint;
  v_n int := 0;
begin
  for r in
    select * from public.app_whapi_pending
    where done_at is null and due_at <= now()
    order by sent_at
    limit 20
    for update skip locked
  loop
    -- the engine (or an earlier pending row) wrote this edition in the meantime: nothing to do
    if exists (select 1 from public.tamzit_editions e
               where e.language = r.language and e.edition_type = r.edition_type and e.edition_date = r.edition_date
                 and public.app_edition_slot(e.edition_type, e.time_slot)
                     = public.app_edition_slot(r.edition_type, r.time_slot)) then
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

-- One WhatsApp message: a special update, an edition (parked), or an ad (written, or parked with its edition).
-- Every message also gives the parked editions whose wait is over their chance, so nothing new has to poll.
create or replace function public.app_ingest_sent(p_text text, p_at timestamptz, p_message_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_due int;
  v_ad record;
begin
  v_due := public.app_ingest_due_editions();
  if public.app_is_special_text(p_text) then
    return jsonb_build_object('kind', 'special', 'id', public.app_ingest_special(p_text, p_at), 'due', v_due);
  end if;
  if (public.app_edition_of_text(p_text)).language is not null then
    return jsonb_build_object('kind', 'edition', 'id', null, 'parked',
                              public.app_ingest_edition(p_text, p_at, p_message_id), 'due', v_due);
  end if;
  if btrim(coalesce(p_text, '')) ~ '^>' then
    select * into v_ad from public.app_ingest_ad(p_text, p_at);
    return jsonb_build_object('kind', 'ad', 'id', v_ad.element_id, 'parked', v_ad.parked_for, 'due', v_due);
  end if;
  return case when v_due > 0 then jsonb_build_object('due', v_due) else '{}'::jsonb end;
end;
$$;

revoke execute on function public.app_ingest_ad(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.app_ingest_due_editions() from public, anon, authenticated;
revoke execute on function public.app_ingest_sent(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.app_ingest_ad(text, timestamptz) to service_role;
grant execute on function public.app_ingest_due_editions() to service_role;
grant execute on function public.app_ingest_sent(text, timestamptz, text) to service_role;
