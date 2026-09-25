// Rest periods downloaded from app_rest_periods (computed on the server), kept on the device so the
// Shabbat screen and the notification schedule work offline. Only the reader's recent cities are kept.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import type { StoredPeriods } from './core';

const DAY = 24 * 3600_000;
const BACK_DAYS = 7;
const AHEAD_DAYS = 90;
const MAX_AGE = DAY;
const KEEP_CITIES = 3;

type RestPeriodsState = {
  byCity: Record<string, StoredPeriods>;
  put: (cityId: string, data: StoredPeriods) => void;
};

export const useRestPeriodsStore = create<RestPeriodsState>()(
  persist(
    (set) => ({
      byCity: {},
      put: (cityId, data) =>
        set((s) => {
          const others = Object.entries(s.byCity)
            .filter(([id]) => id !== cityId)
            .sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt))
            .slice(0, KEEP_CITIES - 1);
          return { byCity: { ...Object.fromEntries(others), [cityId]: data } };
        }),
    }),
    {
      name: 'tamzit-rest-periods',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ byCity: s.byCity }),
    },
  ),
);

const subscribeHydration = (cb: () => void) => useRestPeriodsStore.persist.onFinishHydration(cb);
const isHydrated = () => useRestPeriodsStore.persist.hasHydrated();

/** True once the stored periods were read from the device (render the gate only after this). */
export function useRestPeriodsHydrated() {
  return useSyncExternalStore(subscribeHydration, isHydrated, isHydrated);
}

/** Changes whenever new periods for the city arrive (use as a dependency to recompute). */
export function useRestPeriodsVersion(cityId: string) {
  return useRestPeriodsStore((s) => s.byCity[cityId]?.fetchedAt ?? null);
}

/** Missing, older than a day, or ending within a month. */
export function needsRestSync(cityId: string, now = new Date()) {
  const e = useRestPeriodsStore.getState().byCity[cityId];
  if (!e) return true;
  return now.getTime() - new Date(e.fetchedAt).getTime() > MAX_AGE || new Date(e.to).getTime() < now.getTime() + 30 * DAY;
}

const inFlight = new Map<string, Promise<boolean>>();

/** Downloads the city's periods from now−7d to now+90d. Returns false on failure (the cache stays). */
export function syncRestPeriods(cityId: string): Promise<boolean> {
  const running = inFlight.get(cityId);
  if (running) return running;
  const job = (async () => {
    const now = new Date();
    const from = new Date(now.getTime() - BACK_DAYS * DAY);
    const to = new Date(now.getTime() + AHEAD_DAYS * DAY);
    const { data, error } = await supabase
      .from('app_rest_periods')
      .select('starts_at,ends_at,kind,includes_shabbat,holiday_name')
      .eq('city_id', cityId)
      .gte('ends_at', from.toISOString())
      .lte('starts_at', to.toISOString())
      .order('starts_at');
    // No rows: the table was not generated for this city (yet); keep using the cache / fallback.
    if (error || !data?.length) return false;
    const rows = data as { starts_at: string; ends_at: string; kind: 'shabbat' | 'yomtov'; includes_shabbat: boolean; holiday_name: string | null }[];
    useRestPeriodsStore.getState().put(cityId, {
      from: from.toISOString(),
      // Complete up to the end of the last period received; later dates use the fallback.
      to: new Date(rows[rows.length - 1].ends_at).toISOString(),
      fetchedAt: now.toISOString(),
      periods: rows.map((r) => ({ s: r.starts_at, e: r.ends_at, k: r.kind, sh: r.includes_shabbat, h: r.holiday_name })),
    });
    return true;
  })()
    .catch(() => false)
    .finally(() => inFlight.delete(cityId));
  inFlight.set(cityId, job);
  return job;
}
