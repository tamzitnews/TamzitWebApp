// The reader's current personal edition: the window between their last two slots, fetched with
// app_personal_edition, refreshed when a new slot passes (timer while open, and when the app comes
// back to the foreground), and mirrored to AsyncStorage so the last edition opens without a network.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { currentWindow, nextSlot } from '@/lib/schedule';
import type { Feed } from '@/lib/types';
import { usePrefs } from '@/state/prefs';
import { personalEditionType } from './editionMeta';

const CACHE_KEY = 'tamzit-last-edition';
const REFRESH_AFTER_MS = 5 * 60_000;

type CacheEntry = { from: string; to: string; slotIndex: number; feed: Feed; savedAt: number };

let cacheRead: Promise<CacheEntry | null> | null = null;
function readCache() {
  if (!cacheRead) {
    cacheRead = AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => (raw ? (JSON.parse(raw) as CacheEntry) : null))
      .catch(() => null);
  }
  return cacheRead;
}
function writeCache(entry: CacheEntry) {
  cacheRead = Promise.resolve(entry);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entry)).catch(() => {});
}

type Win = ReturnType<typeof currentWindow>;

export function usePersonalEdition() {
  const slotTimes = usePrefs((s) => s.slotTimes);
  const frequency = usePrefs((s) => s.frequency);
  const slotsKey = slotTimes.join(',');

  const [win, setWin] = useState<Win>(() => currentWindow(slotTimes));
  const winRef = useRef(win);
  winRef.current = win;
  const slotsRef = useRef(slotTimes);
  slotsRef.current = slotTimes;

  /** Moves to the current window if a slot passed; returns true when it changed. */
  const syncWindow = useCallback(() => {
    const w = currentWindow(slotsRef.current);
    const cur = winRef.current;
    if (w.to.getTime() !== cur.to.getTime() || w.from.getTime() !== cur.from.getTime()) {
      setWin(w);
      return true;
    }
    return false;
  }, []);

  // Slot times changed in settings.
  useEffect(() => {
    syncWindow();
  }, [slotsKey, syncWindow]);

  const [cache, setCache] = useState<CacheEntry | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    readCache().then((e) => {
      if (!alive) return;
      setCache(e);
      setCacheLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const fromISO = win.from.toISOString();
  const toISO = win.to.toISOString();
  const cacheMatches = !!cache && cache.from === fromISO && cache.to === toISO;

  const query = useQuery({
    queryKey: qk.personal(fromISO, toISO),
    queryFn: () => api.personalEdition(new Date(fromISO), new Date(toISO)),
    networkMode: 'offlineFirst',
    placeholderData: cacheMatches ? cache!.feed : undefined,
  });

  // Mirror every fresh result.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    const entry = { from: fromISO, to: toISO, slotIndex: win.slotIndex, feed: query.data, savedAt: Date.now() };
    setCache(entry);
    writeCache(entry);
  }, [query.data, query.isPlaceholderData, fromISO, toISO, win.slotIndex]);

  // Back to the foreground: move to a new slot, or refresh a stale edition.
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      if (syncWindow()) return;
      const q = queryRef.current;
      if (Date.now() - q.dataUpdatedAt > REFRESH_AFTER_MS) q.refetch();
    });
    return () => sub.remove();
  }, [syncWindow]);

  // While the screen is open, switch to the new edition when the next slot arrives.
  useEffect(() => {
    const n = nextSlot(slotTimes);
    if (!n) return;
    const ms = n.at.getTime() - Date.now() + 2_000;
    if (ms <= 0 || ms > 2 ** 31 - 1) return;
    const t = setTimeout(syncWindow, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toISO, slotsKey, syncWindow]);

  const refresh = useCallback(async () => {
    if (!syncWindow()) await queryRef.current.refetch();
  }, [syncWindow]);

  // What to show: the live result; else the saved edition when the request failed or is paused offline.
  const paused = query.fetchStatus === 'paused';
  const failed = query.isError || (paused && !query.data);
  const offline = !query.data && failed && !!cache;
  const feed: Feed | undefined = query.data ?? (offline ? cache!.feed : undefined);
  const slotIndex = query.data ? win.slotIndex : offline ? cache!.slotIndex : win.slotIndex;
  const type = personalEditionType(feed, frequency, slotIndex);
  const readTo = query.data ? toISO : offline ? cache!.to : toISO;

  return {
    feed,
    type,
    readKey: `slot:${readTo}`,
    offline,
    loading: !feed && !failed && (query.isPending || !cacheLoaded),
    error: !feed && failed ? (query.error ?? new Error('offline')) : null,
    refreshing: query.isRefetching && !query.isPlaceholderData,
    refresh,
    retry: () => query.refetch(),
  };
}
