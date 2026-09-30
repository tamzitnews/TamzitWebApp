#!/usr/bin/env node
// Precomputes Shabbat / Yom Tov rest periods for every active city into public.app_rest_periods, and the chol
// hamoed days (Israel) into public.app_calendar_days.
//
// Runs on a server or a developer machine only: @hebcal/core is GPL-2.0, so it is a dependency of
// supabase/scripts and never of the mobile app, which just reads the table.
//
// Rules (same as the app's Shabbat mode):
//  - start = candle lighting: city.candle_minutes before sunset (Jerusalem 40);
//  - end = havdalah: tzeit, sun 8.5° below the horizon;
//  - Shabbat and every Yom Tov (Rosh Hashana, Yom Kippur, Sukkot I, Shmini Atzeret / Simchat Torah,
//    Pesach I and VII, Shavuot), Israel vs. diaspora by city.in_israel (second day abroad);
//  - consecutive rest days form one period; holiday_name is the base name of its first Yom Tov.
//
// Usage:  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node gen_rest_periods.mjs [--months 120] [--city jerusalem] [--dry]
// The tables cover the next 10 years; re-run whenever a city is added to app_cities or its coordinates /
// candle_minutes change (and once every few years to keep the 10-year horizon).
import { HebrewCalendar, Location, flags } from '@hebcal/core';

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const MONTHS = Number(opt('months', 120));
const ONLY_CITY = opt('city', null);
const DRY = args.includes('--dry');
const PAST_DAYS = 7;
const HAVDALAH_DEG = 8.5;
const DAY = 24 * 3600_000;

if (!URL_ || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CHUNK = 100; // rows per request / values per in.(…) filter (keeps URLs short)

const chunks = (list, n = CHUNK) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 'YYYY-MM-DD' of an instant in a time zone. */
const ymdIn = (d, tzid) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** 'YYYY-MM-DD' of a Hebrew date's civil day. */
function ymdOf(hd) {
  const g = hd.greg();
  return `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`;
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function isSaturday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}

function computePeriods(city, from, to) {
  const events = HebrewCalendar.calendar({
    start: from,
    end: to,
    location: new Location(city.lat, city.lon, city.in_israel, city.tzid, city.name_en),
    il: city.in_israel,
    candlelighting: true,
    candleLightingMins: city.candle_minutes,
    havdalahDeg: HAVDALAH_DEG,
    noMinorFast: true,
    noModern: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });

  // Yom Tov days (incl. Yom Kippur) by civil date → base name ('Sukkot', 'Yom Kippur', …).
  const yomTov = new Map();
  for (const ev of events) {
    if (ev.getFlags() & flags.CHAG) {
      const ymd = ymdOf(ev.getDate());
      if (!yomTov.has(ymd)) yomTov.set(ymd, ev.basename());
    }
  }

  const periods = [];
  let start = null;
  for (const ev of events) {
    const t = ev.eventTime;
    if (!t) continue;
    const desc = ev.getDesc();
    if (desc === 'Candle lighting') {
      // A second candle lighting inside a period (Shabbat → Yom Tov, Yom Tov day 2) continues it.
      if (!start) start = t;
    } else if (desc === 'Havdalah' && start) {
      let includesShabbat = false;
      let holidayName = null;
      const last = ymdIn(t, city.tzid);
      for (let d = addDays(ymdIn(start, city.tzid), 1); d <= last; d = addDays(d, 1)) {
        if (isSaturday(d)) includesShabbat = true;
        if (!holidayName && yomTov.has(d)) holidayName = yomTov.get(d);
      }
      periods.push({
        city_id: city.id,
        starts_at: start.toISOString(),
        ends_at: t.toISOString(),
        kind: holidayName ? 'yomtov' : 'shabbat',
        includes_shabbat: includesShabbat,
        holiday_name: holidayName,
      });
      start = null;
    }
  }
  return periods;
}

/** Chol hamoed days (Israel) between `from` and `to`: [{ day, kind: 'chol_hamoed', name }]. */
function cholHamoedDays(from, to) {
  const events = HebrewCalendar.calendar({
    start: from,
    end: to,
    il: true,
    noMinorFast: true,
    noModern: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });
  const out = new Map();
  for (const ev of events) {
    if (ev.getFlags() & flags.CHOL_HAMOED) {
      const day = ymdOf(ev.getDate());
      if (!out.has(day)) out.set(day, { day, kind: 'chol_hamoed', name: ev.basename() });
    }
  }
  return [...out.values()];
}

async function main() {
  const now = new Date();
  const from = new Date(now.getTime() - PAST_DAYS * DAY);
  const to = new Date(now);
  to.setUTCMonth(to.getUTCMonth() + MONTHS);

  let cities = await rest('app_cities?select=id,name_en,lat,lon,tzid,in_israel,candle_minutes&active=eq.true&order=sort');
  if (ONLY_CITY) cities = cities.filter((c) => c.id === ONLY_CITY);
  const names = new Set();
  let total = 0;

  for (const city of cities) {
    // Compute from a few days earlier so that a period already running at `from` keeps its real start.
    const periods = computePeriods(city, new Date(from.getTime() - 5 * DAY), to).filter((p) => p.ends_at >= from.toISOString());
    periods.forEach((p) => p.holiday_name && names.add(p.holiday_name));
    total += periods.length;
    if (DRY) {
      console.log(city.id, periods.length, periods.slice(0, 3));
      continue;
    }
    // Upsert the new set, then drop rows in the window that the new computation no longer has
    // (e.g. after a city's candle_minutes changed): no moment without data for the city.
    for (const part of chunks(periods)) {
      await rest('app_rest_periods?on_conflict=city_id,starts_at', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(part),
      });
    }
    const keep = new Set(periods.map((p) => new Date(p.starts_at).getTime()));
    const existing = await rest(
      `app_rest_periods?select=starts_at&city_id=eq.${encodeURIComponent(city.id)}&ends_at=gte.${encodeURIComponent(from.toISOString())}`,
    );
    const stale = existing.map((r) => r.starts_at).filter((t) => !keep.has(new Date(t).getTime()));
    for (const part of chunks(stale)) {
      await rest(
        `app_rest_periods?city_id=eq.${encodeURIComponent(city.id)}&starts_at=in.(${encodeURIComponent(part.map((t) => `"${t}"`).join(','))})`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      );
    }
    console.log(`${city.id.padEnd(14)} ${periods.length} periods${stale.length ? `, ${stale.length} stale removed` : ''}`);
  }

  // Chol hamoed days in Israel (Sukkot, Pesach) → app_calendar_days: the service sends two editions on them
  // (app_settings.edition_schedule.days.chol_hamoed).
  const days = cholHamoedDays(from, to);
  if (DRY) {
    console.log('chol hamoed', days.map((d) => d.day).join(' '));
  } else if (days.length) {
    for (const part of chunks(days)) {
      await rest('app_calendar_days?on_conflict=day', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(part),
      });
    }
    const keepDays = new Set(days.map((d) => d.day));
    const existing = await rest(`app_calendar_days?select=day&kind=eq.chol_hamoed&day=gte.${from.toISOString().slice(0, 10)}`);
    const stale = existing.map((r) => r.day).filter((d) => !keepDays.has(d));
    for (const part of chunks(stale)) {
      await rest(`app_calendar_days?kind=eq.chol_hamoed&day=in.(${part.join(',')})`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }
    console.log(`chol hamoed: ${days.length} days, ${days[0].day} → ${days[days.length - 1].day}`);
  }

  if (!DRY) {
    // History older than a month is not needed by the app.
    const old = new Date(now.getTime() - 30 * DAY).toISOString();
    await rest(`app_rest_periods?ends_at=lt.${encodeURIComponent(old)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
  console.log(`done: ${cities.length} cities, ${total} periods, ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`);
  console.log('holiday names:', [...names].sort().join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
