// Pure Shabbat / Yom Tov logic (no React Native imports, testable in Node).
// Rest periods come from the server (app_rest_periods, computed with the same rules); when they are
// missing (first launch offline) plain Shabbat is computed here from sunset: Friday candle lighting
// (city.candle_minutes before sunset) to Saturday nightfall (sun 8.5° below the horizon).
import type { City, Language } from '@/lib/types';
import { eveningAt, sunsetAt } from './sunset';

/** One rest period: candle lighting → havdalah. */
export type RestPeriod = {
  start: Date;
  end: Date;
  kind: 'shabbat' | 'yomtov';
  includesShabbat: boolean;
  /** English base name of the first Yom Tov in the period ('Sukkot', 'Yom Kippur', …), or null. */
  holidayName: string | null;
};

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

/** Server rows for one city, as stored on the device (ISO strings). */
export type StoredPeriods = {
  /** The time span the rows are known to be complete for. */
  from: string;
  to: string;
  fetchedAt: string;
  periods: { s: string; e: string; k: 'shabbat' | 'yomtov'; sh: boolean; h: string | null }[];
};

const DAY = 24 * 3600_000;
const TZEIT_DEG = 8.5;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** 'YYYY-MM-DD' of an instant in a time zone. */
export function ymdIn(d: Date, tzid: string) {
  let f = formatters.get(tzid);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tzid, f);
  }
  return f.format(d);
}

function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekday(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Plain Shabbat periods overlapping [from, to], from our own sunset computation. Times are rounded
 * outwards to the minute (candle lighting down, nightfall up), so the fallback never ends early.
 */
export function fallbackPeriods(city: City, from: Date, to: Date): RestPeriod[] {
  const out: RestPeriod[] = [];
  const last = ymdIn(to, city.tzid);
  for (let d = addDays(ymdIn(from, city.tzid), -1); d <= last; d = addDays(d, 1)) {
    if (weekday(d) !== 5) continue;
    const sunset = sunsetAt(d, city.lat, city.lon);
    const tzeit = eveningAt(addDays(d, 1), city.lat, city.lon, TZEIT_DEG);
    if (!sunset || !tzeit) continue;
    const start = new Date(Math.floor((sunset.getTime() - city.candle_minutes * 60_000) / 60_000) * 60_000);
    const end = new Date(Math.ceil(tzeit.getTime() / 60_000) * 60_000);
    if (end > from && start < to) out.push({ start, end, kind: 'shabbat', includesShabbat: true, holidayName: null });
  }
  return out;
}

export function fromStored(stored: StoredPeriods): RestPeriod[] {
  return stored.periods.map((p) => ({
    start: new Date(p.s),
    end: new Date(p.e),
    kind: p.k,
    includesShabbat: p.sh,
    holidayName: p.h,
  }));
}

/**
 * Rest periods overlapping [from, to]: the server's periods where they are known, and the plain
 * Shabbat fallback outside that span (or everywhere, when nothing was downloaded yet).
 */
export function combinePeriods(city: City, stored: StoredPeriods | undefined, from: Date, to: Date): RestPeriod[] {
  const qFrom = new Date(from.getTime() - 4 * DAY); // a period already running at `from` keeps its real start
  if (!stored) return fallbackPeriods(city, qFrom, to).filter((p) => p.end > from && p.start < to);
  const covFrom = new Date(stored.from);
  const covTo = new Date(stored.to);
  const all = fromStored(stored);
  const server = all.filter((p) => p.end > from && p.start < to);
  const outside =
    qFrom < covFrom || to > covTo
      ? fallbackPeriods(city, qFrom, to).filter(
          (p) =>
            (p.start < covFrom || p.start > covTo) &&
            p.end > from &&
            p.start < to &&
            !all.some((x) => x.start < p.end && p.start < x.end),
        )
      : [];
  return [...server, ...outside].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Resting now? When does it end, and when does the next one start? */
export function statusFrom(periods: RestPeriod[], now: Date): RestStatus {
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

// Holiday base names written by supabase/scripts/gen_rest_periods.mjs.
const HOLIDAYS: Record<string, Record<Language, string>> = {
  'Rosh Hashana': { he: 'ראש השנה', en: 'Rosh Hashana', fr: 'Roch Hachana' },
  'Yom Kippur': { he: 'יום כיפור', en: 'Yom Kippur', fr: 'Yom Kippour' },
  Sukkot: { he: 'סוכות', en: 'Sukkot', fr: 'Souccot' },
  'Shmini Atzeret': { he: 'שמיני עצרת', en: 'Shmini Atzeret', fr: 'Chemini Atseret' },
  'Simchat Torah': { he: 'שמחת תורה', en: 'Simchat Torah', fr: 'Sim’hat Torah' },
  Pesach: { he: 'פסח', en: 'Pesach', fr: 'Pessa’h' },
  Shavuot: { he: 'שבועות', en: 'Shavuot', fr: 'Chavouot' },
};

/** Localized holiday name for a `holidayName` key ('Sukkot' → 'סוכות'). */
export function holidayLabel(name: string | null | undefined, lang: Language): string | null {
  if (!name) return null;
  return HOLIDAYS[name]?.[lang] ?? name;
}
