// Shabbat / Yom Tov status, computed on the device with @hebcal/core.
//
// A rest period runs from candle lighting (city.candle_minutes before sunset) until havdalah
// (tzeit, sun 8.5° below the horizon). Consecutive days (Shabbat + Yom Tov, two-day Yom Tov abroad,
// Rosh Hashana) merge into one period. Israel vs. diaspora comes from city.in_israel. Yom Kippur is
// included. During a rest period the app shows the Shabbat screen and sends no notifications.
import { HDate, HebrewCalendar, Locale, Location, flags, type Event } from '@hebcal/core';

import type { City, Language } from './types';

export type RestStatus = {
  /** True between candle lighting and havdalah (Shabbat or Yom Tov). */
  resting: boolean;
  kind: 'shabbat' | 'yomtov' | null;
  /** Havdalah / end of the rest day (when the motzash edition becomes available). */
  endsAt: Date | null;
  /** Next candle lighting. */
  nextStart: Date | null;
  /** Holiday name for the greeting, localized by the caller if needed (English key, see `holidayLabel`). */
  holidayName?: string | null;
  /** True when the current rest period includes Shabbat (also for Yom Tov that falls on Shabbat). */
  includesShabbat?: boolean;
};

/** One rest period: candle lighting → havdalah. */
export type RestPeriod = {
  start: Date;
  end: Date;
  kind: 'shabbat' | 'yomtov';
  includesShabbat: boolean;
  /** English base name of the first Yom Tov in the period ('Sukkot', 'Yom Kippur', …), or null. */
  holidayName: string | null;
};

/** Minutes after havdalah when the Motzei Shabbat edition is ready. */
export const MOTZASH_DELAY_MIN = 30;

/** Used when the reader's city is unknown (cities not loaded yet): Jerusalem, like the default profile. */
export const DEFAULT_CITY: City = {
  id: 'jerusalem',
  name_he: 'ירושלים',
  name_en: 'Jerusalem',
  name_fr: 'Jérusalem',
  lat: 31.7683,
  lon: 35.2137,
  tzid: 'Asia/Jerusalem',
  in_israel: true,
  candle_minutes: 40,
  sort: 10,
};

const HAVDALAH_DEG = 8.5;
const DAY = 24 * 3600_000;

/** 'YYYY-MM-DD' of an instant in a time zone. */
function ymdIn(d: Date, tzid: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** 'YYYY-MM-DD' of a Hebrew date's civil day. */
function ymdOf(hd: HDate) {
  const g = hd.greg();
  return `${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`;
}

function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function isSaturday(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}

function locationOf(city: City) {
  return new Location(city.lat, city.lon, city.in_israel, city.tzid, city.name_en);
}

// Periods are computed for a window of days around "now" and cached per city and window.
const cache = new Map<string, RestPeriod[]>();

function computePeriods(city: City, from: Date, to: Date): RestPeriod[] {
  const events: Event[] = HebrewCalendar.calendar({
    start: from,
    end: to,
    location: locationOf(city),
    il: city.in_israel,
    candlelighting: true,
    candleLightingMins: city.candle_minutes,
    havdalahDeg: HAVDALAH_DEG,
    noMinorFast: true,
    noModern: true,
    noRoshChodesh: true,
    noSpecialShabbat: true,
  });

  // Yom Tov days (incl. Yom Kippur) by civil date.
  const yomTov = new Map<string, string>();
  for (const ev of events) {
    if (ev.getFlags() & flags.CHAG) {
      const ymd = ymdOf(ev.getDate());
      if (!yomTov.has(ymd)) yomTov.set(ymd, ev.basename());
    }
  }

  const periods: RestPeriod[] = [];
  let start: Date | null = null;
  for (const ev of events) {
    const t = (ev as Event & { eventTime?: Date }).eventTime;
    if (!t) continue;
    const desc = ev.getDesc();
    if (desc === 'Candle lighting') {
      // A second candle lighting inside a period (Shabbat → Yom Tov, Yom Tov day 2) continues it.
      if (!start) start = t;
    } else if (desc === 'Havdalah' && start) {
      const end = t;
      let includesShabbat = false;
      let holidayName: string | null = null;
      const first = ymdIn(start, city.tzid);
      const last = ymdIn(end, city.tzid);
      for (let d = addDays(first, 1); d <= last; d = addDays(d, 1)) {
        if (isSaturday(d)) includesShabbat = true;
        if (!holidayName && yomTov.has(d)) holidayName = yomTov.get(d)!;
      }
      periods.push({ start, end, kind: holidayName ? 'yomtov' : 'shabbat', includesShabbat, holidayName });
      start = null;
    }
  }
  return periods;
}

/**
 * Rest periods that overlap [from, to]. Looks a few days back so that a period already in progress
 * at `from` is found with its real start.
 */
export function restPeriods(city: City | undefined, from: Date, to: Date): RestPeriod[] {
  const c = city ?? DEFAULT_CITY;
  // Cache by a 10-day bucket so repeated calls (every render, every minute) are cheap.
  const bucket = Math.floor(from.getTime() / (10 * DAY));
  const spanEnd = Math.max(to.getTime(), (bucket + 1) * 10 * DAY) + 5 * DAY;
  const key = `${c.id}:${c.lat}:${c.lon}:${c.in_israel}:${c.candle_minutes}:${bucket}:${Math.ceil(spanEnd / DAY)}`;
  let all = cache.get(key);
  if (!all) {
    all = computePeriods(c, new Date(bucket * 10 * DAY - 6 * DAY), new Date(spanEnd));
    if (cache.size > 20) cache.clear();
    cache.set(key, all);
  }
  return all.filter((p) => p.end > from && p.start < to);
}

export function restStatus(city: City | undefined, now: Date = new Date()): RestStatus {
  let periods: RestPeriod[];
  try {
    periods = restPeriods(city, now, new Date(now.getTime() + 30 * DAY));
  } catch {
    // Sunset cannot be computed (e.g. polar regions): never block the app.
    return { resting: false, kind: null, endsAt: null, nextStart: null, holidayName: null };
  }
  const current = periods.find((p) => p.start <= now && now < p.end);
  const next = periods.find((p) => p.start > now);
  if (current) {
    return {
      resting: true,
      kind: current.kind,
      endsAt: current.end,
      nextStart: next?.start ?? null,
      holidayName: current.holidayName,
      includesShabbat: current.includesShabbat,
    };
  }
  return {
    resting: false,
    kind: null,
    endsAt: null,
    nextStart: next?.start ?? null,
    holidayName: next?.holidayName ?? null,
    includesShabbat: next?.includesShabbat,
  };
}

/** When the Motzei Shabbat / Motzei Chag edition is ready: MOTZASH_DELAY_MIN after havdalah. */
export function motzashEditionAt(endsAt: Date) {
  return new Date(endsAt.getTime() + MOTZASH_DELAY_MIN * 60_000);
}

const FR_HOLIDAYS: Record<string, string> = {
  'Rosh Hashana': 'Roch Hachana',
  'Yom Kippur': 'Yom Kippour',
  Sukkot: 'Souccot',
  'Shmini Atzeret': 'Chemini Atseret',
  'Simchat Torah': 'Sim’hat Torah',
  Pesach: 'Pessa’h',
  Shavuot: 'Chavouot',
};

/** Localized holiday name for a `holidayName` key ('Sukkot' → 'סוכות'). */
export function holidayLabel(name: string | null | undefined, lang: Language): string | null {
  if (!name) return null;
  if (lang === 'he') return Locale.gettext(name, 'he-x-NoNikud') || name;
  if (lang === 'fr') return FR_HOLIDAYS[name] ?? name;
  return name;
}
