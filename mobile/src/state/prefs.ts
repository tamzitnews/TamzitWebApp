import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Audience, Language, LevelFilter, Style, ThemePref } from '@/lib/types';

// Sent as the profile's slot_times when the frequency changes (the column still exists on the server).
// The reader no longer sees or picks times: the server pushes each edition when it is published.
export const DEFAULT_SLOTS: Record<1 | 2 | 3, string[]> = {
  1: ['21:30'],
  2: ['10:00', '21:30'],
  3: ['10:00', '16:00', '21:30'],
};

/**
 * Local preferences. Before registration this is the onboarding draft; after login the server
 * profile is the source of truth and `syncFromProfile` copies it here so the UI (theme, text size,
 * language) works offline and before the network answers.
 */
export type PrefsState = {
  language: Language;
  audience: Audience;
  topics: string[];
  communities: string[];
  frequency: 1 | 2 | 3;
  slotTimes: string[];
  levelFilter: LevelFilter;
  style: Style;
  theme: ThemePref;
  textScale: number;
  shabbatCityId: string;
  onboardingDone: boolean; // local draft finished (before account)
  topicsTouched: boolean; // user edited topics (otherwise defaults are applied)
  set: (patch: Partial<Omit<PrefsState, 'set' | 'reset'>>) => void;
  reset: () => void;
};

const initial = {
  language: 'he' as Language,
  audience: 'general' as Audience,
  topics: [] as string[],
  communities: [] as string[],
  frequency: 3 as 1 | 2 | 3,
  slotTimes: DEFAULT_SLOTS[3],
  levelFilter: 'important' as LevelFilter,
  style: 'calm' as Style,
  theme: 'system' as ThemePref,
  textScale: 1,
  shabbatCityId: 'jerusalem',
  onboardingDone: false,
  topicsTouched: false,
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      ...initial,
      set: (patch) => set(patch),
      reset: () => set(initial),
    }),
    {
      name: 'tamzit-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ set: _s, reset: _r, ...rest }) => rest,
    },
  ),
);

/** Converts local prefs to the profile patch shape used by app_update_profile. */
export function prefsToProfilePatch(p: PrefsState) {
  return {
    language: p.language,
    audience: p.audience,
    topics: p.topics,
    communities: p.communities,
    frequency: p.frequency,
    slot_times: p.slotTimes,
    level_filter: p.levelFilter,
    style: p.style,
    theme: p.theme,
    text_scale: p.textScale,
    shabbat_city_id: p.shabbatCityId,
  };
}
