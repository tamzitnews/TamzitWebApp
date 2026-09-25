import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';

export const MIN_CHARS = 2;
export const DEBOUNCE_MS = 350;
export const PAGE = 30;
export const MAX_RESULTS = 100;

export function isPremiumRequired(e: unknown) {
  if (e instanceof ApiError) return e.code === 'premium_required' || e.message.includes('premium_required');
  return e instanceof Error && e.message.includes('premium_required');
}

/** `value`, updated only after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** app_search for a (trimmed) term; runs from MIN_CHARS characters and keeps the last results while typing. */
export function useSearch(term: string, limit: number, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.search(term), limit],
    queryFn: () => api.search(term, limit),
    enabled: enabled && term.length >= MIN_CHARS,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: (n, e) => !isPremiumRequired(e) && n < 1,
  });
}
