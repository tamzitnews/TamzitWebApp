// Edition slot times ('HH:MM'): 15-minute steps between 05:00 and 23:00, always in day order.

export const SLOT_STEP = 15;
export const SLOT_MIN = 5 * 60; // 05:00
export const SLOT_MAX = 23 * 60; // 23:00

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function fromMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Earliest and latest time slot `i` may take, so that morning < noon < evening. */
export function slotBounds(times: string[], i: number): { min: number; max: number } {
  const prev = i > 0 ? toMinutes(times[i - 1]) + SLOT_STEP : SLOT_MIN;
  const next = i < times.length - 1 ? toMinutes(times[i + 1]) - SLOT_STEP : SLOT_MAX;
  return { min: Math.max(SLOT_MIN, prev), max: Math.min(SLOT_MAX, next) };
}

/** Every allowed time for slot `i`, in 15-minute steps. */
export function slotChoices(times: string[], i: number): string[] {
  const { min, max } = slotBounds(times, i);
  const first = Math.ceil(min / SLOT_STEP) * SLOT_STEP;
  const out: string[] = [];
  for (let t = first; t <= max; t += SLOT_STEP) out.push(fromMinutes(t));
  return out;
}
