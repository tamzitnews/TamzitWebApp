import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useCities } from '@/lib/queries';
import { DEFAULT_CITY, restStatus, type RestStatus } from '@/lib/shabbat';
import type { City } from '@/lib/types';
import { usePrefs } from '@/state/prefs';
import { BUILTIN_CITIES } from './cities';
import { needsRestSync, syncRestPeriods, useRestPeriodsVersion } from './store';

/** Finds a city by id in the server list, then in the built-in copy, then falls back to Jerusalem. */
export function resolveCity(id: string | null | undefined, cities?: City[]): City {
  return cities?.find((c) => c.id === id) ?? BUILTIN_CITIES.find((c) => c.id === id) ?? DEFAULT_CITY;
}

/**
 * The city that Shabbat times are computed for (profile.shabbat_city_id, mirrored into local prefs).
 * Never undefined: works offline and before the cities list loads.
 */
export function useShabbatCity(): City {
  const id = usePrefs((s) => s.shabbatCityId);
  const cities = useCities();
  return useMemo(() => resolveCity(id, cities.data), [id, cities.data]);
}

/**
 * Live rest status for a city: recomputed every minute, exactly when the rest period starts or ends,
 * and when the app returns to the foreground.
 */
export function useRestStatus(city: City): RestStatus {
  const [now, setNow] = useState(() => new Date());
  const version = useRestPeriodsVersion(city.id); // recompute when downloaded periods arrive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const status = useMemo(() => restStatus(city, now), [city, now, version]);

  useEffect(() => {
    const boundary = status.resting ? status.endsAt : status.nextStart;
    const untilBoundary = boundary ? boundary.getTime() - Date.now() + 1000 : Infinity;
    const t = setTimeout(() => setNow(new Date()), Math.max(1000, Math.min(60_000, untilBoundary)));
    return () => clearTimeout(t);
  }, [status, now]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(new Date());
    });
    return () => sub.remove();
  }, []);

  return status;
}

/**
 * Keeps the reader's rest periods (app_rest_periods for the Shabbat city) on the device: downloads
 * them at startup, when the city changes, when the app returns to the foreground and at least daily.
 * Mount once, inside the providers of the root layout.
 */
export function useRestPeriodsSync() {
  const { id } = useShabbatCity();
  useEffect(() => {
    const run = () => {
      if (needsRestSync(id)) syncRestPeriods(id);
    };
    run();
    const timer = setInterval(run, 3 * 3600_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [id]);
}
