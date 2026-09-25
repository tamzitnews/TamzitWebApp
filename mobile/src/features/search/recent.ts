import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MAX = 5;

/** The reader's last searches (device only), newest first. */
export const useRecentSearches = create<{ items: string[]; add: (q: string) => void; clear: () => void }>()(
  persist(
    (set) => ({
      items: [],
      add: (q) =>
        set((st) => {
          const t = q.trim().replace(/\s+/g, ' ');
          if (t.length < 2) return st;
          const low = t.toLocaleLowerCase();
          if (st.items[0]?.toLocaleLowerCase() === low) return st;
          return { items: [t, ...st.items.filter((x) => x.toLocaleLowerCase() !== low)].slice(0, MAX) };
        }),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'tamzit-recent-searches',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ items }) => ({ items }),
    },
  ),
);
