import { create } from 'zustand';

import type { FeedItem } from './types';

/**
 * In-memory cache of items that are on screen, so modals (share, feedback) opened with only an
 * item id can render the item without another request. Call `remember(items)` when rendering a list.
 */
type ItemStore = {
  byId: Record<string, FeedItem>;
  remember: (items: (FeedItem | null | undefined)[]) => void;
  patch: (id: string, patch: Partial<FeedItem>) => void;
};

export const useItemStore = create<ItemStore>((set) => ({
  byId: {},
  remember: (items) =>
    set((s) => {
      const next = { ...s.byId };
      for (const it of items) if (it) next[it.id] = it;
      return { byId: next };
    }),
  patch: (id, patch) =>
    set((s) => (s.byId[id] ? { byId: { ...s.byId, [id]: { ...s.byId[id], ...patch } } } : s)),
}));
