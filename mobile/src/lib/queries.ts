// React Query hooks shared by all screens. Feature-specific queries may live in their feature folder.
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usePrefs } from '@/state/prefs';
import { api } from './api';
import type { PrefsPatch } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, gcTime: 24 * 60 * 60_000, retry: 1 },
  },
});

export const qk = {
  me: ['me'] as const,
  topics: ['topics'] as const,
  communities: ['communities'] as const,
  cities: ['cities'] as const,
  settings: ['settings'] as const,
  personal: (from: string, to: string) => ['personal', from, to] as const,
  edition: (id: string) => ['edition', id] as const,
  archive: ['archive'] as const,
  saved: ['saved'] as const,
  search: (q: string) => ['search', q] as const,
};

export const useMe = (enabled = true) => useQuery({ queryKey: qk.me, queryFn: api.me, enabled });
export const useTopics = () => useQuery({ queryKey: qk.topics, queryFn: api.topics, staleTime: 3_600_000 });
export const useCommunities = () =>
  useQuery({ queryKey: qk.communities, queryFn: api.communities, staleTime: 3_600_000 });
export const useCities = () => useQuery({ queryKey: qk.cities, queryFn: api.cities, staleTime: 3_600_000 });
export const useAppSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 3_600_000 });

/** Saves profile fields on the server and mirrors the relevant ones into local prefs. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const setPrefs = usePrefs((s) => s.set);
  return useMutation({
    mutationFn: (patch: PrefsPatch) => api.updateProfile(patch),
    onMutate: (patch) => {
      const local: Parameters<typeof setPrefs>[0] = {};
      if (patch.language) local.language = patch.language;
      if (patch.audience) local.audience = patch.audience;
      if (patch.topics) local.topics = patch.topics;
      if (patch.communities) local.communities = patch.communities;
      if (patch.frequency) local.frequency = patch.frequency;
      if (patch.slot_times) local.slotTimes = patch.slot_times;
      if (patch.level_filter) local.levelFilter = patch.level_filter;
      if (patch.style) local.style = patch.style;
      if (patch.theme) local.theme = patch.theme;
      if (patch.text_scale) local.textScale = patch.text_scale;
      if (patch.shabbat_city_id) local.shabbatCityId = patch.shabbat_city_id;
      setPrefs(local);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: ['personal'] });
      qc.invalidateQueries({ queryKey: ['edition'] });
      qc.invalidateQueries({ queryKey: qk.archive });
    },
  });
}
