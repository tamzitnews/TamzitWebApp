import { useLayoutEffect, useMemo, useRef } from 'react';

import { useItemActions } from '@/features/items/actions';
import type { FeedItem } from '@/lib/types';

type Actions = ReturnType<typeof useItemActions>;

/**
 * useItemActions() with handlers whose identity never changes, so memoized list rows
 * (NewsItem is memo) do not re-render on every parent render.
 */
export function useStableItemActions(): Actions {
  const actions = useItemActions();
  const ref = useRef(actions);
  useLayoutEffect(() => {
    ref.current = actions;
  });
  return useMemo(
    () => ({
      toggleSave: (item: FeedItem) => ref.current.toggleSave(item),
      share: (item: FeedItem) => ref.current.share(item),
      feedback: (item: FeedItem) => ref.current.feedback(item),
    }),
    [],
  );
}
