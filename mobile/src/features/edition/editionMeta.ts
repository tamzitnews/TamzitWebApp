import { useMemo } from 'react';

import { useShabbatCity } from '@/features/shabbat/hooks';
import { useRestPeriodsVersion } from '@/features/shabbat/store';
import { EDITION_NAMES, formatDay, formatTime, useLang } from '@/lib/i18n';
import { restPeriods } from '@/lib/shabbat';
import type { City, EditionType, Feed, FeedItem, Language, NextEdition } from '@/lib/types';

/**
 * Edition type of a personal edition: a motzash / erev-shabbat edition in it wins; otherwise the
 * newest engine edition in it (edition_types is newest first); a feed with only special updates is a
 * special update; an empty one is named like the evening edition.
 */
export function personalEditionType(feed: Feed | undefined): EditionType {
  const t = feed?.edition_types ?? [];
  if (t.includes('motzash')) return 'motzash';
  if (t.includes('erev_shabbat')) return 'erev_shabbat';
  return t.find((x) => x !== 'special') ?? t[0] ?? 'evening';
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
 * When the edition came out: its newest news item (the newest-edition feed runs its window up to
 * "now", so the window end would turn last night's edition into today's after midnight); else the
 * end of the window.
 */
export function editionPublishedAt(feed: Feed): string {
  let best = '';
  let bestMs = -Infinity;
  for (const it of feed.items) {
    const ms = Date.parse(it.published_at);
    if (ms > bestMs) {
      bestMs = ms;
      best = it.published_at;
    }
  }
  return best || feed.window.to;
}

const MOTZASH_CHAG: Record<Language, string> = {
  he: 'מהדורת מוצאי החג',
  en: 'After-holiday edition',
  fr: 'Édition de fin de fête',
};
const SOON: Record<Language, string> = { he: 'בקרוב', en: 'soon', fr: 'bientôt' };
const TOMORROW: Record<Language, string> = { he: 'מחר', en: 'tomorrow', fr: 'demain' };
const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };

/** True when a Motzei Shabbat edition at `at` follows a Yom Tov without Shabbat (Motzei Chag). */
function afterChagOnly(city: City, at: Date) {
  try {
    const periods = restPeriods(city, new Date(at.getTime() - 3 * 86_400_000), at);
    const ended = periods.filter((p) => p.end.getTime() <= at.getTime()).pop();
    return !!ended && at.getTime() - ended.end.getTime() < 6 * 3600_000 && !ended.includesShabbat;
  } catch {
    return false;
  }
}

/** "21:00" today, "מחר, 09:00" tomorrow, "יום ראשון, 09:00" later; "בקרוב" once the time has passed. */
function whenLabel(at: Date, now: Date, lang: Language) {
  if (at.getTime() <= now.getTime()) return SOON[lang];
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  if (diff <= 0) return formatTime(at);
  const prefix = diff === 1 ? TOMORROW[lang] : new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long' }).format(at);
  return `${prefix}, ${formatTime(at)}`;
}

/**
 * The reader's next edition for "הבאה: <name> · HH:MM", from feed.next_edition (the server knows the
 * service schedule, chol hamoed, Shabbat and Yom Tov, and the reader's frequency). The time is in the
 * device's local time; null hides the line.
 */
export function useNextEdition(next: NextEdition | null | undefined, now: Date = new Date()): { name: string; time: string } | null {
  const lang = useLang();
  const city = useShabbatCity();
  const periodsVersion = useRestPeriodsVersion(city.id);
  const minute = Math.floor(now.getTime() / 60_000);
  const type = next?.type;
  const atIso = next?.at;
  return useMemo(() => {
    if (!type || !atIso) return null;
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) return null;
    const name = type === 'motzash' && afterChagOnly(city, at) ? MOTZASH_CHAG[lang] : EDITION_NAMES[lang][type];
    return { name, time: whenLabel(at, new Date(minute * 60_000), lang) };
    // periodsVersion: downloaded Shabbat / Yom Tov periods changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, atIso, minute, city, lang, periodsVersion]);
}
