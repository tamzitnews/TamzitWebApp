-- Tamzit app: shared SQL helpers (settings, phone normalisation, word count).
-- The feed, profile and other RPCs of the first version lived here; since the move to the existing tables
-- they are defined in 0009_app_feed_functions.sql. Idempotent (create or replace).

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

revoke execute on function
  public.app_setting_text(text),
  public.app_setting_int(text, int),
  public.app_normalize_phone(text),
  public.app_word_count(text),
  public.app_level_rank(text)
from public, anon, authenticated;

grant execute on function
  public.app_setting_text(text),
  public.app_setting_int(text, int),
  public.app_normalize_phone(text)
to service_role;
