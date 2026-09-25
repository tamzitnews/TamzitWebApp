-- Tamzit app: helpers for the production engine (service role only). See docs/engine-integration.md.
-- Idempotent.

-- Subscriptions can be upserted by the reference of the source system (WhatsApp, RevenueCat, …).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_subscriptions_external_ref_key') then
    alter table public.app_subscriptions add constraint app_subscriptions_external_ref_key unique (external_ref);
  end if;
end $$;

-- Upserts one edition with its items and versions in a single transaction, by external_id.
-- p_edition = {
--   external_id, edition_type, language, audience, published_at, title?, status? ('published' default),
--   items: [ { external_id, topic_id?, level, kind?, community_id?, published_at?, status?, source_url?,
--              corrected_at?, versions: [ { language, audience?, style, headline, body } ] } ]   -- array order = position
-- }
-- Items are upserted (versions of the listed language/audience/style are replaced), the edition's item list is
-- replaced by the given one, and the edition status is written last, so a 'special' edition triggers its push
-- only once its items exist. Returns the edition id.
create or replace function public.app_engine_upsert_edition(p_edition jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ed_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_ver jsonb;
  v_pos int := 0;
  v_status text := coalesce(p_edition ->> 'status', 'published');
begin
  if coalesce(p_edition ->> 'external_id', '') = '' then
    raise exception using errcode = 'P0001', message = 'invalid_value', detail = 'edition external_id is required';
  end if;

  insert into public.app_editions as e (external_id, edition_type, language, audience, published_at, title, status)
  values (
    p_edition ->> 'external_id',
    p_edition ->> 'edition_type',
    coalesce(p_edition ->> 'language', 'he'),
    coalesce(p_edition ->> 'audience', 'general'),
    coalesce((p_edition ->> 'published_at')::timestamptz, now()),
    p_edition ->> 'title',
    'draft'
  )
  on conflict (external_id) do update set
    edition_type = excluded.edition_type, language = excluded.language, audience = excluded.audience,
    published_at = excluded.published_at, title = excluded.title
  returning id into v_ed_id;

  delete from public.app_edition_items where edition_id = v_ed_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_edition -> 'items', '[]'::jsonb)) loop
    v_pos := v_pos + 1;
    insert into public.app_items as i (external_id, topic_id, level, kind, community_id, published_at, status,
                                       source_url, corrected_at)
    values (
      v_item ->> 'external_id',
      v_item ->> 'topic_id',
      coalesce(v_item ->> 'level', 'general'),
      coalesce(v_item ->> 'kind', 'news'),
      v_item ->> 'community_id',
      coalesce((v_item ->> 'published_at')::timestamptz, (p_edition ->> 'published_at')::timestamptz, now()),
      coalesce(v_item ->> 'status', 'published'),
      v_item ->> 'source_url',
      (v_item ->> 'corrected_at')::timestamptz
    )
    on conflict (external_id) do update set
      topic_id = excluded.topic_id, level = excluded.level, kind = excluded.kind,
      community_id = excluded.community_id, published_at = excluded.published_at, status = excluded.status,
      source_url = excluded.source_url, corrected_at = coalesce(excluded.corrected_at, i.corrected_at)
    returning id into v_item_id;

    for v_ver in select * from jsonb_array_elements(coalesce(v_item -> 'versions', '[]'::jsonb)) loop
      insert into public.app_item_versions (item_id, language, audience, style, headline, body)
      values (v_item_id, v_ver ->> 'language', coalesce(v_ver ->> 'audience', 'general'), v_ver ->> 'style',
              v_ver ->> 'headline', v_ver ->> 'body')
      on conflict (item_id, language, audience, style) do update set
        headline = excluded.headline, body = excluded.body;
    end loop;

    insert into public.app_edition_items (edition_id, item_id, position) values (v_ed_id, v_item_id, v_pos)
    on conflict (edition_id, item_id) do update set position = excluded.position;
  end loop;

  update public.app_editions set status = v_status where id = v_ed_id and status is distinct from v_status;
  return v_ed_id;
end;
$$;

revoke execute on function public.app_engine_upsert_edition(jsonb) from public, anon, authenticated;
grant execute on function public.app_engine_upsert_edition(jsonb) to service_role;
