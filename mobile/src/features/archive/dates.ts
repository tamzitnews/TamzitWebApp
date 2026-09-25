// Day grouping and relative day labels shared by the archive, saved and search screens.
import { formatDay, formatTime } from '@/lib/i18n';
import type { Language } from '@/lib/types';

const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };
const REL: Record<Language, { today: string; yesterday: string }> = {
  he: { today: 'היום', yesterday: 'אתמול' },
  en: { today: 'Today', yesterday: 'Yesterday' },
  fr: { today: "Aujourd'hui", yesterday: 'Hier' },
};

// Intl formatters are costly to create on Hermes: keep one per language and shape.
const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(lang: Language, opts: Intl.DateTimeFormatOptions) {
  const key = lang + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALES[lang], opts);
    formatters.set(key, f);
  }
  return f;
}

/** Local calendar day, e.g. "2026-9-24" (used as a section key). */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Local midnight of a dayKey(). */
export function dayStart(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole calendar days between `d` and `now` in local time (0 = today, 1 = yesterday). */
export function daysAgo(d: Date, now: Date) {
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Section title: "היום", "אתמול", or "יום שלישי, 22 בספטמבר" (with the year when it is not this year). */
export function dayTitle(d: Date, lang: Language, now: Date) {
  const n = daysAgo(d, now);
  if (n === 0) return REL[lang].today;
  if (n === 1) return REL[lang].yesterday;
  if (d.getFullYear() === now.getFullYear()) return formatDay(d, lang);
  return fmt(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** Short date without weekday: "22 בספטמבר" (+ year when it is not this year). */
export function shortDate(d: Date, lang: Language, now: Date) {
  const sameYear = d.getFullYear() === now.getFullYear();
  return fmt(lang, sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** Label for an item from any day: "היום, 07:30", "אתמול, 20:00", or "22 בספטמבר". */
export function itemTimeLabel(iso: string, lang: Language, now: Date) {
  const d = new Date(iso);
  const n = daysAgo(d, now);
  if (n === 0) return `${REL[lang].today}, ${formatTime(d)}`;
  if (n === 1) return `${REL[lang].yesterday}, ${formatTime(d)}`;
  return shortDate(d, lang, now);
}
