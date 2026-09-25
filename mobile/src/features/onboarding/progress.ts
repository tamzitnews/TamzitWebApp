// Where the reader is in the onboarding. Persisted because a language change that flips the text
// direction reloads the app on Android; after the reload /welcome resumes at the saved step.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const STEPS = ['language', 'track', 'topics', 'rhythm', 'style'] as const;
export type StepId = (typeof STEPS)[number];

export const STEP_HREF = {
  language: '/onboarding/language',
  track: '/onboarding/track',
  topics: '/onboarding/topics',
  rhythm: '/onboarding/rhythm',
  style: '/onboarding/style',
} as const satisfies Record<StepId, string>;

type ProgressState = {
  /** The step on screen, or null when the onboarding is not in progress. */
  step: StepId | null;
  setStep: (step: StepId | null) => void;
};

export const useOnboardingProgress = create<ProgressState>()(
  persist(
    (set) => ({
      step: null,
      setStep: (step) => set({ step }),
    }),
    {
      name: 'tamzit-onboarding',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ step }) => ({ step }),
    },
  ),
);

/** True once the persisted progress has been read from storage. */
export function useProgressHydrated() {
  const [done, setDone] = useState(() => useOnboardingProgress.persist.hasHydrated());
  useEffect(() => {
    const unsub = useOnboardingProgress.persist.onFinishHydration(() => setDone(true));
    setDone(useOnboardingProgress.persist.hasHydrated());
    return unsub;
  }, []);
  return done;
}
