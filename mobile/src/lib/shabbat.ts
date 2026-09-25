// Shabbat / Yom Tov status.
//
// A rest period runs from candle lighting (city.candle_minutes before sunset) until havdalah
// (tzeit, sun 8.5° below the horizon); consecutive rest days form one period, Israel vs. diaspora
// follows city.in_israel, and Yom Kippur is included. The periods are computed on the server
// (supabase/scripts/gen_rest_periods.mjs → app_rest_periods) and downloaded by useRestPeriodsSync()
// into a store on the device. Before the first download (first launch offline) plain Shabbat is
// computed on the device from sunset; Yom Tov needs the downloaded data.
import { combinePeriods, statusFrom, type RestPeriod, type RestStatus } from '@/features/shabbat/core';
import { useRestPeriodsStore } from '@/features/shabbat/store';
import type { City } from './types';

export type { RestPeriod, RestStatus } from '@/features/shabbat/core';
export { holidayLabel } from '@/features/shabbat/core';

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

const DAY = 24 * 3600_000;

/** Rest periods that overlap [from, to], ascending. A period already running at `from` is included. */
export function restPeriods(city: City | undefined, from: Date, to: Date): RestPeriod[] {
  const c = city ?? DEFAULT_CITY;
  return combinePeriods(c, useRestPeriodsStore.getState().byCity[c.id], from, to);
}

export function restStatus(city: City | undefined, now: Date = new Date()): RestStatus {
  try {
    return statusFrom(restPeriods(city, now, new Date(now.getTime() + 30 * DAY)), now);
  } catch {
    // Sunset cannot be computed (e.g. polar regions): never block the app.
    return { resting: false, kind: null, endsAt: null, nextStart: null, holidayName: null };
  }
}

/** When the Motzei Shabbat / Motzei Chag edition is ready: MOTZASH_DELAY_MIN after havdalah. */
export function motzashEditionAt(endsAt: Date) {
  return new Date(endsAt.getTime() + MOTZASH_DELAY_MIN * 60_000);
}
