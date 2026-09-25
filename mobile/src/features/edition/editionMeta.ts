import { useMemo } from 'react';

import { EDITION_NAMES, formatDay, formatTime, slotEditionType, useLang } from '@/lib/i18n';
import { useCities } from '@/lib/queries';
import { nextSlot } from '@/lib/schedule';
import { restStatus } from '@/lib/shabbat';
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
 * The reader's next edition: the next slot, or the motzash edition when Shabbat / Yom Tov starts
 * before that slot (the next edition then comes after havdalah).
 */
export function useNextEdition(now: Date = new Date()): { name: string; time: string } | null {
  const lang = useLang();
  const slotTimes = usePrefs((s) => s.slotTimes);
  const frequency = usePrefs((s) => s.frequency);
  const cityId = usePrefs((s) => s.shabbatCityId);
  const cities = useCities();
  const minute = Math.floor(now.getTime() / 60_000);
  return useMemo(() => {
    const at = new Date(minute * 60_000);
    const next = nextSlot(slotTimes, at);
    const city = cities.data?.find((c) => c.id === cityId);
    const current = restStatus(city, at);
    if (current.resting && current.endsAt) {
      return { name: EDITION_NAMES[lang].motzash, time: formatTime(current.endsAt) };
    }
    const upcoming = restStatus(city, at).nextStart;
    if (upcoming && next && upcoming < next.at) {
      const during = restStatus(city, new Date(upcoming.getTime() + 60_000));
      if (during.endsAt) return { name: EDITION_NAMES[lang].motzash, time: formatTime(during.endsAt) };
    }
    if (!next) return null;
    return { name: EDITION_NAMES[lang][slotEditionType(frequency, next.index)], time: formatTime(next.at) };
  }, [minute, slotTimes, frequency, cityId, cities.data, lang]);
}
