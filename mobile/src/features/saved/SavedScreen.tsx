import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, View, type ListRenderItem } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { AppBar, EmptyState, ErrorState, Icon, Loading, Screen, T } from '@/components/ui';
import { useRefreshOnFocus } from '@/features/archive/useRefreshOnFocus';
import { useStrings } from '@/lib/i18n';
import { useItemStore } from '@/lib/itemStore';
import { qk } from '@/lib/queries';
import type { FeedItem } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { LiveNewsItem } from './LiveNewsItem';
import { SavedStrings } from './strings';
import { SwipeToRemove } from './SwipeToRemove';
import { removeFromSaved, useSavedItems } from './useSavedItems';
import { useStableItemActions } from './useStableItemActions';

const rowLayout = LinearTransition.duration(220);
const rowExit = FadeOut.duration(160);

/** The saved tab: every item the reader bookmarked, newest saved first; works offline. */
export function SavedScreen() {
  const { c } = useTheme();
  const s = useStrings(SavedStrings);
  const qc = useQueryClient();
  const { query, offline } = useSavedItems();
  useRefreshOnFocus(qk.saved);
  const actions = useStableItemActions();
  const remember = useItemStore((st) => st.remember);

  const items = query.data;
  useEffect(() => {
    if (items) remember(items);
  }, [items, remember]);

  // Un-saving here removes the row at once; the server list refreshes when the request settles.
  const onToggleSave = useCallback(
    (item: FeedItem) => {
      if (item.saved) removeFromSaved(qc, item.id);
      actions.toggleSave(item);
    },
    [qc, actions],
  );

  const count = items?.length ?? 0;
  const renderItem: ListRenderItem<FeedItem> = useCallback(
    ({ item, index }) => (
      <Animated.View exiting={rowExit}>
        <SwipeToRemove label={s.remove} onRemove={() => onToggleSave({ ...item, saved: true })}>
          <LiveNewsItem
            item={item}
            last={index === count - 1}
            onToggleSave={onToggleSave}
            onShare={actions.share}
            onFeedback={actions.feedback}
          />
        </SwipeToRemove>
      </Animated.View>
    ),
    [count, onToggleSave, actions, s.remove],
  );

  const [pulling, setPulling] = useState(false);
  const refetch = query.refetch;
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  }, [refetch]);

  const header = (
    <>
      <AppBar title={s.title} subtitle={count > 0 ? s.count(count) : undefined} />
      {offline ? (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            marginHorizontal: space[5],
            marginBottom: space[2],
            paddingHorizontal: space[3],
            paddingVertical: space[2],
            borderRadius: radius.md,
            backgroundColor: c.surfaceTint,
          }}>
          <Icon as={WifiOff} size={18} color="ink" />
          <T variant="caption" style={{ flex: 1 }}>
            {s.offline}
          </T>
        </View>
      ) : null}
    </>
  );

  if (query.isPending) {
    return (
      <Screen header={header}>
        <Loading />
      </Screen>
    );
  }
  if (!items) {
    return (
      <Screen header={header}>
        <ErrorState message={s.error} retryLabel={s.retry} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <Animated.FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        itemLayoutAnimation={rowLayout}
        initialNumToRender={6}
        windowSize={9}
        contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[8], flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', paddingBottom: space[12] }}>
            <EmptyState icon={Bookmark} title={s.emptyTitle} text={s.emptyText} />
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={onRefresh}
            tintColor={c.brand}
            colors={[c.brand]}
            progressBackgroundColor={c.surfaceRaised}
          />
        }
      />
    </Screen>
  );
}

const keyOf = (it: FeedItem) => it.id;
