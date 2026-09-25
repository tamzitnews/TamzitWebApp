import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { FeedItem } from '@/lib/types';

// Saved items are available offline: every successful load is copied to the device (per user),
// and when the server cannot be reached the last copy is shown instead.

type SavedCache = { items: FeedItem[]; at: number };

async function cacheKey() {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  return uid ? `tamzit-saved:${uid}` : null;
}

async function readCache(): Promise<SavedCache | null> {
  try {
    const key = await cacheKey();
    const raw = key ? await AsyncStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as SavedCache) : null;
  } catch {
    return null;
  }
}

async function writeCache(items: FeedItem[]) {
  try {
    const key = await cacheKey();
    if (key) await AsyncStorage.setItem(key, JSON.stringify({ items, at: Date.now() } satisfies SavedCache));
  } catch {
    // storage full or unavailable: the online list still works
  }
}

/** Whether the list on screen came from the device copy because the server was unreachable. */
export const useSavedSource = create<{ offline: boolean }>(() => ({ offline: false }));

async function fetchSaved(): Promise<FeedItem[]> {
  try {
    const items = await api.saved();
    useSavedSource.setState({ offline: false });
    void writeCache(items);
    return items;
  } catch (e) {
    const cached = await readCache();
    if (!cached) throw e;
    useSavedSource.setState({ offline: true });
    return cached.items;
  }
}

/** Saved items (app_saved), newest saved first, with the device copy as placeholder and fallback. */
export function useSavedItems() {
  const [placeholder, setPlaceholder] = useState<FeedItem[] | undefined>();
  useEffect(() => {
    let alive = true;
    readCache().then((c) => {
      if (alive && c) setPlaceholder(c.items);
    });
    return () => {
      alive = false;
    };
  }, []);
  const query = useQuery({
    queryKey: qk.saved,
    queryFn: fetchSaved,
    // Run the request even when the device reports no network, so the fallback kicks in.
    networkMode: 'always',
    placeholderData: placeholder,
  });
  const offline = useSavedSource((s) => s.offline) && !query.isPlaceholderData;
  return { query, offline };
}

/** Removes an item from the saved list right away (before the server answers) and from the device copy. */
export function removeFromSaved(qc: QueryClient, itemId: string) {
  const next = qc.setQueryData<FeedItem[]>(qk.saved, (list) => list?.filter((it) => it.id !== itemId));
  if (next && !useSavedSource.getState().offline) void writeCache(next);
}
