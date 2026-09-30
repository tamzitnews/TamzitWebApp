// The reader's current personal edition: their newest edition (app_personal_edition with no window;
// the server knows the reader's frequency and track), refreshed every few minutes while open, when the
// app returns to the foreground, and at once when an edition push arrives (lib/notifications
// invalidates ['personal']). Mirrored to AsyncStorage so the last edition opens without a network.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import type { Feed } from '@/lib/types';
import { useSession } from '@/state/session';
import { personalEditionType } from './editionMeta';

const CACHE_KEY = 'tamzit-last-edition';
/** Look for a new edition this often while the edition is on screen. */
const REFETCH_INTERVAL_MS = 5 * 60_000;
/** Back in the foreground, refetch when the edition is older than this. */
const FOREGROUND_STALE_MS = 60_000;

// Entries saved by earlier builds also carry from / to / slotIndex, and no uid.
type CacheEntry = { feed: Feed; savedAt: number; uid?: string };

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

export function usePersonalEdition() {
  const qc = useQueryClient();
  const uid = useSession().session?.user.id;

  // `recent`: saved only minutes ago, so (almost surely) still the newest edition: shown while loading.
  const [cache, setCache] = useState<{ entry: CacheEntry | null; recent: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    readCache().then((entry) => {
      if (alive) setCache({ entry, recent: !!entry && Date.now() - entry.savedAt < REFETCH_INTERVAL_MS });
    });
    return () => {
      alive = false;
    };
  }, []);
  const cacheLoaded = cache !== null;
  // Another reader's saved edition is never shown.
  const saved = cache?.entry;
  const ownCache = saved && (!saved.uid || !uid || saved.uid === uid) ? saved : null;
  const recentCache = ownCache && cache?.recent ? ownCache : null;

  const query = useQuery({
    queryKey: qk.personal,
    queryFn: async () => {
      const feed = await api.personalEdition();
      writeCache({ feed, savedAt: Date.now(), uid });
      return feed;
    },
    networkMode: 'offlineFirst',
    placeholderData: recentCache?.feed,
    // A push refreshes the edition as soon as it is published; this covers a missed push.
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  // Back to the foreground: refresh an edition older than a minute.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      const updatedAt = qc.getQueryState(qk.personal)?.dataUpdatedAt ?? 0;
      if (Date.now() - updatedAt > FOREGROUND_STALE_MS) qc.refetchQueries({ queryKey: qk.personal, type: 'active' });
    });
    return () => sub.remove();
  }, [qc]);

  const { refetch } = query;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // What to show: the live result (kept in memory even when a refetch fails); else the saved
  // edition when the request failed or is paused offline. The line "אין חיבור" shows in both cases.
  const paused = query.fetchStatus === 'paused';
  const failed = query.isError || paused;
  const live = query.data && !query.isPlaceholderData ? query.data : undefined;
  const fallback = failed && !live ? ownCache : null;
  const feed: Feed | undefined = live ?? fallback?.feed ?? query.data;
  const offline = failed && !!feed;
  const type = personalEditionType(feed);
  // app_mark_read with the engine edition id marks that edition read in the archive too.
  const readKey = feed?.edition_id ? feed.edition_id : `slot:${feed?.window.to ?? ''}`;

  return {
    feed,
    type,
    readKey,
    offline,
    loading: !feed && !failed && (query.isPending || !cacheLoaded),
    error: !feed && failed ? (query.error ?? new Error('offline')) : null,
    refreshing: query.isRefetching && !query.isPlaceholderData,
    refresh,
    retry: () => refetch(),
  };
}
