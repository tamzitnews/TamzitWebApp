// Renders one Feed (personal edition or an archived engine edition) as a virtualized list:
// header → special updates → news (or the empty-level note) → ad → community → good news → end.
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { FlatList, Platform, RefreshControl, View, type ListRenderItem, type ViewToken } from 'react-native';

import { NewsItem } from '@/components/news/NewsItem';
import { MiniPlayer, useTrack } from '@/features/audio/MiniPlayer';
import { useAudioStore } from '@/features/audio/store';
import { useItemActions } from '@/features/items/actions';
import { api } from '@/lib/api';
import { useLang, useStrings } from '@/lib/i18n';
import { useItemStore } from '@/lib/itemStore';
import { qk } from '@/lib/queries';
import type { Ad, EditionType, Feed, FeedItem } from '@/lib/types';
import { usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { AdSlot } from './AdSlot';
import { CommunityLabel, EmptyLevel, EndOfEdition, GoodNews } from './Closing';
import { EditionHeader } from './EditionHeader';
import { allItems, editionDate, itemCount, useNextEdition } from './editionMeta';
import { SpecialCard } from './SpecialCard';
import { S } from './strings';

type Row =
  | { key: string; type: 'header' }
  | { key: string; type: 'special'; item: FeedItem }
  | { key: string; type: 'item'; item: FeedItem; last: boolean }
  | { key: string; type: 'empty' }
  | { key: string; type: 'ad'; ad: Ad }
  | { key: string; type: 'communityLabel'; name: string }
  | { key: string; type: 'good'; item: FeedItem }
  | { key: string; type: 'end' };

function buildRows(feed: Feed): Row[] {
  const rows: Row[] = [{ key: 'header', type: 'header' }];
  for (const it of feed.special) rows.push({ key: `s:${it.id}`, type: 'special', item: it });
  if (feed.items.length === 0 && feed.special.length === 0) rows.push({ key: 'empty', type: 'empty' });
  feed.items.forEach((it, i) => rows.push({ key: `i:${it.id}`, type: 'item', item: it, last: i === feed.items.length - 1 }));
  if (feed.ad) rows.push({ key: `ad:${feed.ad.id}`, type: 'ad', ad: feed.ad });
  let group: string | null = null;
  feed.community.forEach((it, i) => {
    const name = it.community_name ?? it.topic_name ?? '';
    if (name !== group) {
      group = name;
      rows.push({ key: `cl:${name}:${i}`, type: 'communityLabel', name });
    }
    const nextName = feed.community[i + 1]?.community_name ?? feed.community[i + 1]?.topic_name ?? null;
    rows.push({ key: `c:${it.id}`, type: 'item', item: it, last: nextName !== name });
  });
  if (feed.good_news) rows.push({ key: `g:${feed.good_news.id}`, type: 'good', item: feed.good_news });
  rows.push({ key: 'end', type: 'end' });
  return rows;
}

// Marked-read keys for this app session, so re-rendering or re-visiting doesn't call the server again.
const markedRead = new Set<string>();

const keyExtractor = (r: Row) => r.key;
const viewabilityConfig = { itemVisiblePercentThreshold: 40 };

export type EditionFeedProps = {
  feed: Feed;
  type: EditionType;
  name: string;
  /** Key for app_mark_read: `slot:<ISO>` for a personal edition, the edition id for an archived one. */
  readKey: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rendered above the list (for example, the offline line). */
  banner?: ReactElement | null;
  /**
   * 'inline': the player is docked at the bottom of this screen (screens outside the tabs).
   * 'dock': the audio is offered to the GlobalPlayerDock above the tab bar (the edition tab).
   */
  player?: 'inline' | 'dock';
  /** Where the player's title leads back to. */
  audioHref?: string;
};

export function EditionFeed({
  feed,
  type,
  name,
  readKey,
  refreshing,
  onRefresh,
  banner,
  player = 'inline',
  audioHref,
}: EditionFeedProps) {
  const { c } = useTheme();
  const lang = useLang();
  const qc = useQueryClient();
  const levelFilter = usePrefs((s) => s.levelFilter);
  const next = useNextEdition();

  // Items on screen, for the share / feedback modals.
  useEffect(() => {
    useItemStore.getState().remember(allItems(feed));
  }, [feed]);

  // Stable handlers so memoized rows don't re-render when the screen does.
  const actions = useItemActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const onToggleSave = useCallback((it: FeedItem) => actionsRef.current.toggleSave(it), []);
  const onShare = useCallback((it: FeedItem) => actionsRef.current.share(it), []);
  const onFeedback = useCallback((it: FeedItem) => actionsRef.current.feedback(it), []);

  const s = useStrings(S);
  const listenTitle = `${s.listen} · ${name}`;
  const track = useTrack(feed.audio, listenTitle, audioHref);
  const play = useAudioStore((s) => s.play);
  const offer = useAudioStore((s) => s.offer);
  useEffect(() => {
    if (player === 'dock') offer(track);
  }, [player, track, offer]);
  const onListen = useMemo(() => (track ? () => void play(track).catch(() => {}) : undefined), [track, play]);

  const rows = useMemo(() => buildRows(feed), [feed]);
  // The motzash edition sums up a whole Shabbat: item times would only add noise.
  const showTime = type !== 'motzash';
  const date = editionDate(feed.window.to, lang);
  const count = itemCount(feed);

  // Mark as read once the end of the edition is on screen.
  const readKeyRef = useRef(readKey);
  readKeyRef.current = readKey;
  const markRead = useCallback(() => {
    const key = readKeyRef.current;
    if (markedRead.has(key)) return;
    markedRead.add(key);
    api
      .markRead(key)
      .then(() => qc.invalidateQueries({ queryKey: qk.archive }))
      .catch(() => markedRead.delete(key));
  }, [qc]);
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
    if (viewableItems.some((v) => v.item?.type === 'end')) markReadRef.current();
  }).current;

  const renderItem: ListRenderItem<Row> = useCallback(
    ({ item: row }) => {
      switch (row.type) {
        case 'header':
          return <EditionHeader type={type} name={name} date={date} count={count} minutes={feed.minutes} onListen={onListen} />;
        case 'special':
          return <SpecialCard item={row.item} onToggleSave={onToggleSave} onShare={onShare} onFeedback={onFeedback} />;
        case 'item':
          return (
            <NewsItem
              item={row.item}
              last={row.last}
              showTime={showTime}
              onToggleSave={onToggleSave}
              onShare={onShare}
              onFeedback={onFeedback}
            />
          );
        case 'empty':
          return <EmptyLevel criticalOnly={levelFilter === 'critical'} />;
        case 'ad':
          return <AdSlot ad={row.ad} />;
        case 'communityLabel':
          return <CommunityLabel name={row.name} />;
        case 'good':
          return <GoodNews item={row.item} />;
        case 'end':
          return <EndOfEdition next={next} />;
      }
    },
    [type, name, date, count, feed.minutes, onListen, onToggleSave, onShare, onFeedback, levelFilter, next, showTime],
  );

  return (
    <View style={{ flex: 1 }}>
      {banner}
      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={renderItem}
        contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[4] }}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              colors={[c.brand]}
              tintColor={c.brand}
              progressBackgroundColor={c.surfaceRaised}
            />
          ) : undefined
        }
      />
      {track && player === 'inline' ? <PlayerDock track={track} /> : null}
    </View>
  );
}

const PlayerDock = memo(function PlayerDock({ track }: { track: NonNullable<ReturnType<typeof useTrack>> }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2], backgroundColor: c.surface }}>
      <MiniPlayer track={track} />
    </View>
  );
});
