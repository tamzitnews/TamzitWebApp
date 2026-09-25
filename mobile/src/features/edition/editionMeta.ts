import { useMemo } from 'react';

import { useShabbatCity } from '@/features/shabbat/hooks';
import { EDITION_NAMES, formatDay, formatTime, slotEditionType, useLang } from '@/lib/i18n';
import { nextEditionAt } from '@/lib/notifications';
import type { EditionType, Feed, FeedItem, Language } from '@/lib/types';
import { usePrefs } from '@/state/prefs';

/** Edition type of a personal edition: a motzash / erev-shabbat edition in the window wins, else the slot. */
export function personalEditionType(feed: Feed | undefined, frequency: 1 | 2 | 3, slotIndex: number): EditionType {
  const t = feed?.edition_types ?? [];
  if (t.includes('motzash')) return 'motzash';
  if (t.includes('erev_shabbat')) return 'erev_shabbat';
  return slotEditionType(frequency, slotIndex);
}

/** Edition type of one engine edition (archive). */
export function engineEditionType(feed: Feed): EditionType {
  return feed.edition_types[0] ?? 'evening';
}

export function editionName(type: EditionType, lang: Language, title?: string | null) {
  return title?.trim() || EDITION_NAMES[lang][type];
}

/** Number of items the reader will read (news, special updates and community). */
export function itemCount(feed: Feed) {
  return feed.items.length + feed.special.length + feed.community.length;
}

export function allItems(feed: Feed): FeedItem[] {
  const out = [...feed.special, ...feed.items, ...feed.community];
  if (feed.good_news) out.push(feed.good_news);
  return out;
}

export function editionDate(iso: string, lang: Language) {
  return formatDay(iso, lang);
}

/**
 * The reader's next edition for "הבאה: <name> · HH:MM": the shared schedule in lib/notifications
 * (slots outside Shabbat / Yom Tov, the Motzei Shabbat edition after havdalah), so the end card and
 * the notifications always agree.
 */
export function useNextEdition(now: Date = new Date()): { name: string; time: string } | null {
  const lang = useLang();
  const slotTimes = usePrefs((s) => s.slotTimes);
  const frequency = usePrefs((s) => s.frequency);
  const city = useShabbatCity();
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const at = new Date(minute * 60_000);
    const next = nextEditionAt(slotTimes, frequency, city, at);
    if (!next) return null;
    return { name: EDITION_NAMES[lang][next.type], time: whenLabel(next.at, at, lang) };
  }, [minute, slotTimes, frequency, city, lang]);
}

const TOMORROW: Record<Language, string> = { he: 'מחר', en: 'tomorrow', fr: 'demain' };
const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };

/** "13:00" today, "מחר, 07:30" tomorrow, "יום ראשון, 07:30" later. */
function whenLabel(at: Date, now: Date, lang: Language) {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  if (diff <= 0) return formatTime(at);
  const prefix = diff === 1 ? TOMORROW[lang] : new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long' }).format(at);
  return `${prefix}, ${formatTime(at)}`;
}
