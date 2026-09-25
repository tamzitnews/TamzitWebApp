-- Tamzit app: Shabbat / Yom Tov rest periods per city, precomputed on the server.
-- Written by supabase/scripts/gen_rest_periods.mjs (service role); the app reads them with the anon
-- or user key to show the Shabbat screen and to skip notifications. Idempotent.
--
-- A period runs from candle lighting (city.candle_minutes before sunset) to havdalah (tzeit, sun
-- 8.5° below the horizon). Consecutive rest days (Shabbat + Yom Tov, two-day Yom Tov abroad, Rosh
-- Hashana) form one period. Israel vs. diaspora follows app_cities.in_israel.

create table if not exists public.app_rest_periods (
  city_id          text not null references public.app_cities(id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  kind             text not null check (kind in ('shabbat', 'yomtov')),
  includes_shabbat boolean not null default false,
  holiday_name     text null,
  primary key (city_id, starts_at),
  check (ends_at > starts_at)
);

create index if not exists app_rest_periods_city_ends on public.app_rest_periods (city_id, ends_at);

alter table public.app_rest_periods enable row level security;

revoke all on public.app_rest_periods from anon, authenticated;
grant select on public.app_rest_periods to anon, authenticated;

drop policy if exists app_rest_periods_read on public.app_rest_periods;
create policy app_rest_periods_read on public.app_rest_periods for select to anon, authenticated using (true);
