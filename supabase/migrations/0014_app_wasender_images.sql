-- Tamzit app: the ad image as it was sent on WhatsApp (WaSender).
-- The app-wasender edge function receives WaSender webhook events for the messages the service's WhatsApp lines send.
-- When one is an image whose caption is an ad's text (an ad / donation_campaign / cta_link element of the last day), it
-- decrypts the image through WaSender, copies it to app-media/wasender/ and records it here. The ad then shows that image;
-- else the attached Drive image (once shared and copied); else the link's preview image. Idempotent.

create table if not exists public.app_ad_images (
  element_id  bigint primary key,           -- tamzit_edition_elements.id (the ad)
  source      text not null default 'wasender',
  message_id  text,                          -- WhatsApp message id
  image_url   text not null,                 -- public copy in app-media
  created_at  timestamptz not null default now()
);
alter table public.app_ad_images enable row level security;

-- Caption / ad text reduced for comparison: no WhatsApp markup, no "> …" label line, no links, single spaces.
create or replace function public.app_ad_norm(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(coalesce(p, ''), '(^|\n)[[:space:]]*>[^\n]*', '\1', 'g'),   -- label lines
               'https?://[^[:space:]]+', ' ', 'g'),                                       -- links
             '[*_~]', '', 'g'),                                                            -- markup
           '[[:space:]]+', ' ', 'g'));
$$;

-- The ad element whose text this caption is (sent within a day of the element), or null. Compares the first 60
-- characters of the normalized texts either way round (WhatsApp captions can be shortened or extended).
create or replace function public.app_ad_element_for_caption(p_caption text, p_at timestamptz) returns bigint
language sql stable security definer set search_path = public as $$
  with c as (select public.app_ad_norm(p_caption) as t)
  select el.id
  from public.tamzit_edition_elements el, c
  where el.element_type in ('ad', 'donation_campaign', 'cta_link')
    and coalesce(btrim(el.content_text), '') <> ''
    and el.created_at between coalesce(p_at, now()) - interval '1 day' and coalesce(p_at, now()) + interval '1 hour'
    and length(c.t) >= 20
    and (position(left(c.t, 60) in public.app_ad_norm(el.content_text)) > 0
         or position(left(public.app_ad_norm(el.content_text), 60) in c.t) > 0)
  order by abs(extract(epoch from el.created_at - coalesce(p_at, now()))), el.id desc
  limit 1;
$$;

-- Ad JSON: as in 0011, the image is now the WhatsApp (WaSender) image first, then the attached Drive image, then the
-- link's preview image.
create or replace function public.app_ad_json(p_element_id bigint, p_lang text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  el public.tamzit_edition_elements;
  v_lines text[];
  s text;
  v_label text;
  v_sponsor text;
  v_body text[] := '{}';
  v_link text;
  v_image text;
begin
  select * into el from public.tamzit_edition_elements where id = p_element_id;
  if not found or coalesce(btrim(el.content_text), '') = '' then
    return null;
  end if;
  v_lines := regexp_split_to_array(replace(el.content_text, E'\r', ''), E'\n');
  foreach s in array v_lines loop
    s := btrim(s);
    continue when s = '';
    if s ~ '^>' then
      v_label := coalesce(v_label, nullif(btrim(public.app_wa_clean(regexp_replace(s, '^>+[[:space:]]*|[[:space:]:]+$', '', 'g'))), ''));
      continue;
    end if;
    continue when s ~ '^(https?://[^[:space:]]+)$';
    if v_sponsor is null and cardinality(v_body) = 0 and s ~ '^\*[^*]+\*$' then
      v_sponsor := nullif(btrim(public.app_wa_clean(s)), '');
      continue;
    end if;
    v_body := v_body || s;
  end loop;
  v_link := (regexp_match(el.content_text, '(https?://[^[:space:]*]+)'))[1];
  -- the image that went out on WhatsApp: this element's, or that of an identical ad (the engine repeats ads)
  select i.image_url into v_image
  from public.app_ad_images i
  join public.tamzit_edition_elements o on o.id = i.element_id
  where i.element_id = el.id
     or (public.app_ad_norm(o.content_text) = public.app_ad_norm(el.content_text)
         and o.created_at > el.created_at - interval '30 days')
  order by (i.element_id = el.id) desc, i.created_at desc
  limit 1;
  if v_image is null then
    v_image := public.app_media_url(el.media_id, 'image');
  end if;
  if v_image is null and v_link is not null then
    select p.image_url into v_image from public.app_link_previews p where p.url = v_link and p.status = 'ok';
  end if;
  return jsonb_build_object(
    'id', 'ad' || el.id,
    'label', left(coalesce(v_label, case p_lang when 'en' then 'Sponsored' when 'fr' then 'Publicité' else 'פרסומת' end), 80),
    'sponsor', left(v_sponsor, 120),
    'body', public.app_wa_clean(array_to_string(v_body, E'\n')),
    'link_url', v_link,
    'image_url', v_image
  );
end;
$$;

-- Privileges: server only (app-wasender uses the service role).
revoke execute on function public.app_ad_norm(text) from public, anon, authenticated;
revoke execute on function public.app_ad_element_for_caption(text, timestamptz) from public, anon, authenticated;
grant execute on function public.app_ad_element_for_caption(text, timestamptz) to service_role;
revoke execute on function public.app_ad_json(bigint, text) from public, anon, authenticated;
