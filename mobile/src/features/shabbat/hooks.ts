import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useCities } from '@/lib/queries';
import { DEFAULT_CITY, restStatus, type RestStatus } from '@/lib/shabbat';
import type { City } from '@/lib/types';
import { usePrefs } from '@/state/prefs';
import { BUILTIN_CITIES } from './cities';

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
  const status = useMemo(() => restStatus(city, now), [city, now]);

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
