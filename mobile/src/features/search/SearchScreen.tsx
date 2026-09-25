import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { History, Lock, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, ScrollView, View, type ListRenderItem } from 'react-native';

import { AppBar, Button, Chip, EmptyState, ErrorState, Icon, Loading, Screen, T } from '@/components/ui';
import { LiveNewsItem } from '@/features/saved/LiveNewsItem';
import { useStableItemActions } from '@/features/saved/useStableItemActions';
import { useStrings } from '@/lib/i18n';
import { useItemStore } from '@/lib/itemStore';
import { useMe } from '@/lib/queries';
import type { FeedItem } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useRecentSearches } from './recent';
import { SearchBox } from './SearchBox';
import { SearchStrings } from './strings';
import { isPremiumRequired, MAX_RESULTS, MIN_CHARS, PAGE, useDebounced, useSearch } from './useSearch';

const openPremium = () => router.push('/premium');

/** Search across every item (premium). Free readers who reach it see the premium card. */
export function SearchScreen() {
  const s = useStrings(SearchStrings);
  const qc = useQueryClient();
  const me = useMe();
  const actions = useStableItemActions();
  const remember = useItemStore((st) => st.remember);
  const recent = useRecentSearches((st) => st.items);
  const addRecent = useRecentSearches((st) => st.add);
  const clearRecent = useRecentSearches((st) => st.clear);

  const [text, setText] = useState('');
  const debounced = useDebounced(text);
  // A recent-search chip or the keyboard's search key searches at once, without the debounce.
  const [instant, setInstant] = useState<string | null>(null);
  const term = (instant !== null && instant === text ? instant : debounced).trim();
  const typed = text.trim();

  const [more, setMore] = useState<string | null>(null); // term for which "more results" was asked
  const limit = more === term ? MAX_RESULTS : PAGE;

  const notPremium = me.data ? !me.data.is_premium : false;
  const search = useSearch(term, limit, !notPremium);
  const locked = notPremium || isPremiumRequired(search.error);
  const results = typed.length >= MIN_CHARS ? search.data : undefined;

  useEffect(() => {
    if (search.data) remember(search.data);
  }, [search.data, remember]);

  // Remember the search once the reader engages with its results (or leaves with results on screen).
  const latest = useRef({ term, hasResults: false });
  useEffect(() => {
    latest.current = { term, hasResults: !!results?.length && !search.isPlaceholderData };
  });
  const keepRecent = useCallback(() => {
    if (latest.current.hasResults) addRecent(latest.current.term);
  }, [addRecent]);
  useEffect(() => keepRecent, [keepRecent]);

  const onSubmit = useCallback(() => {
    const t = text.trim();
    if (t.length < MIN_CHARS) return;
    setInstant(text);
    addRecent(t);
    Keyboard.dismiss();
  }, [text, addRecent]);

  const pickRecent = useCallback(
    (q: string) => {
      setText(q);
      setInstant(q);
      addRecent(q);
      Keyboard.dismiss();
    },
    [addRecent],
  );

  // Saving from the results: flip the flag in every cached search now, refresh them next time.
  const onToggleSave = useCallback(
    (item: FeedItem) => {
      keepRecent();
      qc.setQueriesData<FeedItem[]>({ queryKey: ['search'] }, (list) =>
        list?.map((it) => (it.id === item.id ? { ...it, saved: !item.saved } : it)),
      );
      qc.invalidateQueries({ queryKey: ['search'], refetchType: 'none' });
      actions.toggleSave(item);
    },
    [qc, actions, keepRecent],
  );
  const onShare = useCallback(
    (item: FeedItem) => {
      keepRecent();
      actions.share(item);
    },
    [actions, keepRecent],
  );
  const onFeedback = useCallback(
    (item: FeedItem) => {
      keepRecent();
      actions.feedback(item);
    },
    [actions, keepRecent],
  );

  const count = results?.length ?? 0;
  const renderItem: ListRenderItem<FeedItem> = useCallback(
    ({ item, index }) => (
      <LiveNewsItem item={item} last={index === count - 1} onToggleSave={onToggleSave} onShare={onShare} onFeedback={onFeedback} />
    ),
    [count, onToggleSave, onShare, onFeedback],
  );

  let body;
  if (locked) {
    body = <Upsell />;
  } else if (typed.length === 0) {
    body = <Start recent={recent} onPick={pickRecent} onClear={clearRecent} />;
  } else if (typed.length < MIN_CHARS) {
    body = (
      <T variant="caption" color="inkMuted" style={{ paddingHorizontal: space[5], paddingTop: space[4] }}>
        {s.minChars}
      </T>
    );
  } else if (!results || (results.length === 0 && search.isPlaceholderData)) {
    body = search.isError ? (
      <ErrorState message={s.error} retryLabel={s.retry} onRetry={() => search.refetch()} />
    ) : (
      <Loading />
    );
  } else if (results.length === 0) {
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: space[6] }}>
        <EmptyState icon={Search} title={s.noResultsTitle(term)} text={s.noResultsText} />
      </ScrollView>
    );
  } else {
    body = (
      <FlatList
        data={results}
        keyExtractor={keyOf}
        renderItem={renderItem}
        initialNumToRender={5}
        windowSize={9}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={keepRecent}
        style={{ opacity: search.isPlaceholderData ? 0.6 : 1 }}
        contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[8] }}
        ListHeaderComponent={
          <T variant="caption" color="inkMuted" weight={600} accessibilityRole="header" style={{ paddingTop: space[2] }}>
            {s.results(count)}
          </T>
        }
        ListFooterComponent={
          count >= limit && limit < MAX_RESULTS ? (
            <View style={{ alignItems: 'center', marginTop: space[4] }}>
              <Button variant="quiet" loading={search.isFetching} onPress={() => setMore(term)}>
                {s.more}
              </Button>
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <Screen header={<AppBar back title={s.title} />}>
      <View style={{ paddingHorizontal: space[5], paddingBottom: space[2] }}>
        <SearchBox
          value={text}
          onChangeText={setText}
          onSubmit={onSubmit}
          label={s.label}
          placeholder={s.placeholder}
          clearLabel={s.clear}
          busyLabel={s.searching}
          busy={!locked && search.isFetching && typed.length >= MIN_CHARS}
          autoFocus={!notPremium}
          editable={!notPremium}
        />
      </View>
      {body}
    </Screen>
  );
}

const keyOf = (it: FeedItem) => it.id;

/** Empty query: recent searches as chips, or a short explanation. */
function Start({ recent, onPick, onClear }: { recent: string[]; onPick: (q: string) => void; onClear: () => void }) {
  const s = useStrings(SearchStrings);
  const chips = useMemo(() => recent.slice(0, 5), [recent]);
  if (chips.length === 0) {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: space[6] }}>
        <EmptyState icon={Search} title={s.introTitle} text={s.introText} />
      </ScrollView>
    );
  }
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[8] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[4], marginBottom: space[2] }}>
        <T variant="overline" color="inkMuted" accessibilityRole="header" style={{ marginHorizontal: space[1] }}>
          {s.recent}
        </T>
        <Button variant="quiet" onPress={onClear} accessibilityLabel={s.clearRecentLabel}>
          {s.clearRecent}
        </Button>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
        {chips.map((q) => (
          <Chip key={q} label={q} icon={History} onPress={() => onPick(q)} />
        ))}
      </View>
    </ScrollView>
  );
}

/** Shown to readers without premium (or when the server answers premium_required). */
function Upsell() {
  const { c } = useTheme();
  const s = useStrings(SearchStrings);
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[8] }}>
      <View style={{ backgroundColor: c.sunSoft, borderRadius: radius.lg, padding: space[5], gap: space[3], alignItems: 'flex-start' }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.sun, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={Lock} size={24} color="onSun" />
        </View>
        <T variant="title" accessibilityRole="header">
          {s.upsellTitle}
        </T>
        <T variant="body">{s.upsellText}</T>
        <Button variant="sun" onPress={openPremium} style={{ marginTop: space[1] }}>
          {s.details}
        </Button>
      </View>
    </ScrollView>
  );
}
