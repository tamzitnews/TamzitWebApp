import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api } from '@/lib/api';
import { useItemStore } from '@/lib/itemStore';
import { qk } from '@/lib/queries';
import type { Feed, FeedItem } from '@/lib/types';

/** Save / share / feedback actions for a news item, shared by every list of items. */
export function useItemActions() {
  const qc = useQueryClient();
  const patch = useItemStore((s) => s.patch);

  const toggleSave = useMutation({
    mutationFn: (item: FeedItem) => api.toggleSave(item.id),
    onMutate: (item) => {
      const saved = !item.saved;
      patch(item.id, { saved });
      // Optimistically flip the flag in every cached feed that contains the item.
      qc.setQueriesData<Feed>({ predicate: (q) => q.queryKey[0] === 'personal' || q.queryKey[0] === 'edition' }, (f) =>
        f ? flipInFeed(f, item.id, saved) : f,
      );
      return { saved };
    },
    onSuccess: (saved, item) => patch(item.id, { saved }),
    onError: (_e, item) => patch(item.id, { saved: item.saved }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.saved }),
  });

  return {
    toggleSave: (item: FeedItem) => toggleSave.mutate(item),
    share: (item: FeedItem) => {
      useItemStore.getState().remember([item]);
      router.push({ pathname: '/share/[itemId]', params: { itemId: item.id } });
    },
    feedback: (item: FeedItem) => {
      useItemStore.getState().remember([item]);
      router.push({ pathname: '/feedback/[itemId]', params: { itemId: item.id } });
    },
  };
}

function flipInFeed(f: Feed, id: string, saved: boolean): Feed {
  const map = (it: FeedItem) => (it.id === id ? { ...it, saved } : it);
  return {
    ...f,
    items: f.items.map(map),
    special: f.special.map(map),
    community: f.community.map(map),
    good_news: f.good_news ? map(f.good_news) : null,
  };
}
