import { memo } from 'react';

import { NewsItem } from '@/components/news/NewsItem';
import { useLang } from '@/lib/i18n';
import { useItemStore } from '@/lib/itemStore';
import type { FeedItem } from '@/lib/types';
import { itemTimeLabel } from '@/features/archive/dates';

/**
 * NewsItem for lists that mix days (saved, search): shows "היום, 07:30" / "אתמול" / a date, and
 * reads the item from useItemStore so a save toggled anywhere shows here at once.
 */
export const LiveNewsItem = memo(function LiveNewsItem({
  item,
  last,
  onToggleSave,
  onShare,
  onFeedback,
}: {
  item: FeedItem;
  last?: boolean;
  onToggleSave: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
  onFeedback: (item: FeedItem) => void;
}) {
  const lang = useLang();
  const live = useItemStore((s) => s.byId[item.id]) ?? item;
  return (
    <NewsItem
      item={live}
      last={last}
      timeLabel={itemTimeLabel(live.published_at, lang, new Date())}
      onToggleSave={onToggleSave}
      onShare={onShare}
      onFeedback={onFeedback}
    />
  );
});
