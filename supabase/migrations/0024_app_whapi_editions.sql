-- Tamzit app: regular editions from WhatsApp when the engine does not log them.
--
-- On 2026-09-30 the engine sent the evening edition on WhatsApp but wrote nothing to tamzit_editions, so the app
-- showed nothing and pushed nothing. The app already receives, through Whapi's webhook (app-whapi), every message the
-- service's numbers send and every post in its WhatsApp channel (the channel gets the edition first). Now:
-- (a) app_ingest_edition: a message with an edition header ("📻 *תמצית החדשות*" then "*מהדורת ערב, …*", the English
--     and French headers too) and sections (📌) is written to tamzit_editions as the engine writes it
--     (language, edition_type, time_slot, edition_date, the full text), unless that edition (language, type, slot,
--     date) is already there. The push, the classification and the archive follow from the row as usual. When the
--     engine does write, it writes before sending, so nothing is added.
-- (b) app_ingest_ad: the sponsor message ("> המהדורה בחסות: …") of such an edition becomes its ad element (its image
--     then comes from the same message, as for every ad). Only for editions written here: when the engine logs an
--     edition it logs its ad too.
-- (c) app_ingest_sent: one call per message for app-whapi: special update, edition or ad.
-- app_whapi_editions records which editions came from WhatsApp. app_settings.whatsapp_editions_fallback turns (a)
-- and (b) off. Idempotent.

create table if not exists public.app_whapi_editions (
  edition_id  bigint primary key references public.tamzit_editions (id) on delete cascade,
  message_id  text,
  created_at  timestamptz not null default now()
);
alter table public.app_whapi_editions enable row level security;
revoke all on public.app_whapi_editions from anon, authenticated;

insert into public.app_settings as s
  (key, value, title, description, category, value_type, constraints, default_value, is_public, is_secret, sort)
values
  ('whatsapp_editions_fallback', 'true'::jsonb, 'קליטת מהדורות מהוואטסאפ כשהמנוע לא רושם אותן',
   E'מה זה: true: מהדורה רגילה שנשלחה בוואטסאפ (מהמספר המחובר ל-Whapi או בערוץ של השירות) ולא נרשמה על ידי המנוע, נכתבת לאפליקציה מהטקסט שנשלח: היא מופיעה במהדורה ובארכיון, נשלחת עליה התראה והידיעות שלה מסווגות. גם הודעת החסות שלה ("> המהדורה בחסות") נקלטת עם התמונה. false: רק מה שהמנוע רושם.\n'
   'על מה זה משפיע: אם מהדורה מגיעה לאפליקציה גם כשהמנוע לא רשם אותה. כשהמנוע כן רושם (לפני השליחה), לא נוסף כלום.\n'
   'איפה זה ממומש: שרת: public.app_ingest_edition ו-public.app_ingest_ad (מיגרציה 0024), שנקראות מ-supabase/functions/_shared/whapi.ts בכל הודעה שנשלחת.\n'
   'פורמט: true או false, בלי מירכאות.',
   'מערכת', 'bool', '{}'::jsonb, 'true'::jsonb, false, false, 5040)
on conflict (key) do update set
  title = excluded.title, description = excluded.description, category = excluded.category,
  value_type = excluded.value_type, constraints = excluded.constraints,
  default_value = excluded.default_value, is_public = excluded.is_public, is_secret = excluded.is_secret,
  sort = excluded.sort;

-- The edition a text is, as the engine names it (nulls when it is not an edition): from its name line ("📻
-- *תמצית החדשות*" …) and the line after it. The name is usually the first line; before Shabbat, a fast or a holiday
-- a notice to the readers comes first ("*קוראים יקרים,* …"), so the first 20 lines are searched.
create or replace function public.app_edition_of_text(p text, out language text, out edition_type text, out time_slot text)
language plpgsql immutable set search_path = public as $$
declare
  v_lines text[] := (regexp_split_to_array(btrim(replace(coalesce(p, ''), E'\r', '')), E'\n'))[1:20];
  v_line text;
  l1 text;
  l2 text;
  v_teens boolean := false;
begin
  foreach v_line in array v_lines loop
    v_line := btrim(regexp_replace(v_line, '[*_~]', '', 'g'));
    continue when v_line = '';
    if l1 is not null then
      l2 := v_line;
      exit;
    end if;
    -- the name alone on its line (after the radio emoji)
    if v_line ~ '^[^[:alnum:]]*תמצית החדשות לנוער[^[:alnum:]]*$' then
      language := 'hebrew'; v_teens := true;
    elsif v_line ~ '^[^[:alnum:]]*תמצית החדשות[^[:alnum:]]*$' then
      language := 'hebrew';
    elsif v_line ~* '^[^[:alnum:]]*israel news highlights[^[:alnum:]]*$' then
      language := 'english';
    elsif v_line ~* '^[^[:alnum:]]*l''essentiel de l''actualit[ée][^[:alnum:]]*$' then
      language := 'french';
    else
      continue;
    end if;
    l1 := v_line;
  end loop;
  if l2 is null then
    language := null;
    return;
  end if;
  time_slot := case
    when l2 ~* '^(מהדורת בוקר|morning edition|[ÉéEe]dition du matin)' then 'בוקר'
    when l2 ~* '^(מהדורת צו?הריים|afternoon edition|noon edition|[ÉéEe]dition de l''apr[èe]s-midi|[ÉéEe]dition de midi)' then 'צהריים'
    when l2 ~* '^(מהדורת ערב|מהדורת מוצאי שבת|evening edition|motzei shabbat edition|saturday night edition|[ÉéEe]dition du soir)' then 'ערב'
    when l2 ~* '^(המהדורה היומית|daily edition|[ÉéEe]dition quotidienne|[ÉéEe]dition du quotidienne|[ÉéEe]dition du jou ?r)' then 'יומי'
  end;
  if time_slot is null then
    language := null;
    return;
  end if;
  edition_type := case when v_teens then 'teens' when time_slot = 'יומי' then 'daily' else 'classic' end;
end;
$$;

-- Writes a regular edition that was sent on WhatsApp, unless that edition (language, type, slot, date) is there
-- already. Returns the new tamzit_editions id, or null.
create or replace function public.app_ingest_edition(p_text text, p_at timestamptz, p_message_id text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(replace(coalesce(p_text, ''), E'\r', ''));
  v_at timestamptz := least(coalesce(p_at, now()), now());
  v_date date := (v_at at time zone 'Asia/Jerusalem')::date;
  k record;
  v_id bigint;
begin
  if not public.app_setting_bool('whatsapp_editions_fallback', true) then
    return null;
  end if;
  select * into k from public.app_edition_of_text(v_text);
  -- an edition has sections (📌) or at least news bullets; a notice alone ("המהדורה הבאה תישלח …") has neither
  if k.language is null or length(v_text) < 300
     or (position('📌' in v_text) = 0
         and (select count(*) from regexp_matches(v_text, E'(^|\n)[[:space:]]*•[[:space:]]+[^•[:space:]]', 'g')) < 3) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('app_ingest_edition:' || k.language || ':' || k.edition_type || ':'
                                         || public.app_edition_slot(k.edition_type, k.time_slot) || ':' || v_date));
  if exists (select 1 from public.tamzit_editions e
             where e.language = k.language and e.edition_type = k.edition_type and e.edition_date = v_date
               and public.app_edition_slot(e.edition_type, e.time_slot) = public.app_edition_slot(k.edition_type, k.time_slot)) then
    return null;
  end if;
  insert into public.tamzit_editions (created_at, edition_date, main_text, language, edition_type, time_slot)
  values (v_at, v_date, v_text, k.language, k.edition_type, k.time_slot)
  returning id into v_id;
  insert into public.app_whapi_editions (edition_id, message_id) values (v_id, p_message_id);
  return v_id;
end;
$$;

-- The sponsor message of an edition written from WhatsApp → its ad element (once per text). Returns the new
-- tamzit_edition_elements id, or null (not a sponsor message, already there, or the engine logs this edition).
create or replace function public.app_ingest_ad(p_text text, p_at timestamptz) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_text text := btrim(replace(coalesce(p_text, ''), E'\r', ''));
  v_at timestamptz := least(coalesce(p_at, now()), now());
  v_edition bigint;
  v_id bigint;
begin
  if not public.app_setting_bool('whatsapp_editions_fallback', true)
     or v_text !~* '^>[[:space:]*_]*(המהדורה בחסות|this edition is sponsored|sponsored by|[ÉéEe]dition parrain)' then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('app_ingest_ad:' || md5(v_text)));
  if public.app_ad_element_for_caption(v_text, v_at) is not null then
    return null;
  end if;
  -- the edition being sent: one written here, started in the last half hour (the sponsor message follows it)
  select e.id into v_edition
  from public.app_whapi_editions w join public.tamzit_editions e on e.id = w.edition_id
  where e.created_at between v_at - interval '30 minutes' and v_at + interval '2 minutes'
  order by (e.language = coalesce(public.app_lang_name(public.app_text_lang(v_text)), 'hebrew')) desc, e.created_at desc
  limit 1;
  if v_edition is null then
    return null;
  end if;
  insert into public.tamzit_edition_elements (created_at, edition_id, element_type, content_text, position)
  values (v_at, v_edition, 'ad', v_text, 0)
  returning id into v_id;
  return v_id;
end;
$$;

-- One WhatsApp message (app-whapi): {"kind": "special" | "edition" | "ad", "id": <new id or null>}, or {} when it is
-- none of them.
create or replace function public.app_ingest_sent(p_text text, p_at timestamptz, p_message_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.app_is_special_text(p_text) then
    return jsonb_build_object('kind', 'special', 'id', public.app_ingest_special(p_text, p_at));
  end if;
  if (public.app_edition_of_text(p_text)).language is not null then
    return jsonb_build_object('kind', 'edition', 'id', public.app_ingest_edition(p_text, p_at, p_message_id));
  end if;
  if btrim(coalesce(p_text, '')) ~ '^>' then
    return jsonb_build_object('kind', 'ad', 'id', public.app_ingest_ad(p_text, p_at));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke execute on function public.app_edition_of_text(text) from public, anon, authenticated;
revoke execute on function public.app_ingest_edition(text, timestamptz, text) from public, anon, authenticated;
revoke execute on function public.app_ingest_ad(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.app_ingest_sent(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.app_edition_of_text(text) to service_role;
grant execute on function public.app_ingest_edition(text, timestamptz, text) to service_role;
grant execute on function public.app_ingest_ad(text, timestamptz) to service_role;
grant execute on function public.app_ingest_sent(text, timestamptz, text) to service_role;
