// Edition slots: the reader's personal edition times ('HH:MM', local time).

export type Slot = { at: Date; index: number };

function atTime(day: Date, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** All slot instants between `from` and `to` (inclusive), ascending. */
export function slotsBetween(slotTimes: string[], from: Date, to: Date): Slot[] {
  const out: Slot[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  const sorted = [...slotTimes].sort();
  while (day <= to) {
    sorted.forEach((t, index) => {
      const at = atTime(day, t);
      if (at >= from && at <= to) out.push({ at, index });
    });
    day.setDate(day.getDate() + 1);
  }
  return out;
}

/** The latest slot at or before `now`, and the one before it: the current personal edition window. */
export function currentWindow(slotTimes: string[], now = new Date()) {
  const from = new Date(now.getTime() - 3 * 24 * 3600_000);
  const past = slotsBetween(slotTimes, from, now);
  const last = past[past.length - 1];
  const prev = past[past.length - 2];
  if (!last) return { from: new Date(now.getTime() - 24 * 3600_000), to: now, slotIndex: 0 };
  return { from: prev ? prev.at : new Date(last.at.getTime() - 24 * 3600_000), to: last.at, slotIndex: last.index };
}

/** The next slot after `now`. */
export function nextSlot(slotTimes: string[], now = new Date()): Slot | null {
  const to = new Date(now.getTime() + 3 * 24 * 3600_000);
  const upcoming = slotsBetween(slotTimes, new Date(now.getTime() + 1000), to);
  return upcoming[0] ?? null;
}

/** 'HH:MM' for a Date in local time. */
export function hhmm(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
