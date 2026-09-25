// Shabbat / Yom Tov status. STUB — the settings agent implements this with @hebcal/core.
import type { City } from './types';

export type RestStatus = {
  /** True between candle lighting and havdalah (Shabbat or Yom Tov). */
  resting: boolean;
  kind: 'shabbat' | 'yomtov' | null;
  /** Havdalah / end of the rest day (when the motzash edition becomes available). */
  endsAt: Date | null;
  /** Next candle lighting. */
  nextStart: Date | null;
  /** Holiday name for the greeting, localized by the caller if needed. */
  holidayName?: string | null;
};

export function restStatus(_city: City | undefined, _now: Date = new Date()): RestStatus {
  return { resting: false, kind: null, endsAt: null, nextStart: null, holidayName: null };
}
