import { router } from 'expo-router';
import { History } from 'lucide-react-native';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { RefreshControl, SectionList, View, type SectionListData, type SectionListRenderItem } from 'react-native';

import { AppBar, Button, EmptyState, ErrorState, Loading, Screen, T } from '@/components/ui';
import { useLang, useStrings } from '@/lib/i18n';
import { useAppSettings, useMe } from '@/lib/queries';
import type { ArchiveEntry, Language } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { dayKey, dayStart, dayTitle } from './dates';
import { EditionRow } from './EditionRow';
import { PremiumCallout } from './PremiumCallout';
import { SearchEntry } from './SearchEntry';
import { ArchiveStrings } from './strings';
import { useArchive } from './useArchive';
import { useRefreshOnFocus } from './useRefreshOnFocus';

type Section = { key: string; title: string; locked: boolean; data: ArchiveEntry[] };

/** Locked (older) editions shown to free readers as a teaser under the open days. */
const LOCKED_TEASER = 3;

function buildSections(entries: ArchiveEntry[], lang: Language, now: Date, lockedTitle: string): Section[] {
  const sorted = [...entries].sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  const sections: Section[] = [];
  const byDay = new Map<string, Section>();
  const locked: ArchiveEntry[] = [];
  for (const e of sorted) {
    if (e.locked) {
      locked.push(e);
      continue;
    }
    const d = new Date(e.published_at);
    const k = dayKey(d);
    let sec = byDay.get(k);
    if (!sec) {
      sec = { key: k, title: dayTitle(d, lang, now), locked: false, data: [] };
      byDay.set(k, sec);
      sections.push(sec);
    }
    sec.data.push(e);
  }
  if (locked.length) sections.push({ key: 'locked', title: lockedTitle, locked: true, data: locked.slice(0, LOCKED_TEASER) });
  return sections;
}

const openEntry = (e: ArchiveEntry) => {
  if (e.locked) router.push('/premium');
  else router.push({ pathname: '/edition/[id]', params: { id: e.id } });
};
const openPremium = () => router.push('/premium');

/** The archive tab: editions by day. Free readers get the last 7 days; premium readers everything and search. */
export function ArchiveScreen() {
  const { c } = useTheme();
  const lang = useLang();
  const s = useStrings(ArchiveStrings);
  const me = useMe();
  const settings = useAppSettings();
  const { query, queryKey, loadMore, exhausted, loadingMore } = useArchive();
  useRefreshOnFocus(queryKey);

  const entries = query.data;
  const freeDays = Number(settings.data?.free_archive_days) || 7;
  // Premium status comes from app_me; until it arrives, the rows' own `locked` flags tell.
  const premium: boolean | undefined = me.data ? me.data.is_premium : undefined;
  const locked = premium === undefined ? !!entries?.some((e) => e.locked) : !premium;

  // Keyed by the calendar day so "היום / אתמול" are recomputed after midnight.
  const today = dayKey(new Date());
  const sections = useMemo(
    () => (entries ? buildSections(entries, lang, dayStart(today), s.olderThan(freeDays)) : []),
    [entries, lang, s, freeDays, today],
  );

  const [pulling, setPulling] = useState(false);
  const refetchArchive = query.refetch;
  const refetchMe = me.refetch;
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await Promise.all([refetchArchive(), refetchMe()]);
    } finally {
      setPulling(false);
    }
  }, [refetchArchive, refetchMe]);

  const openSearch = useCallback(() => router.push(locked ? '/premium' : '/search'), [locked]);

  const renderItem: SectionListRenderItem<ArchiveEntry, Section> = useCallback(
    ({ item, section }) => <EditionRow entry={item} withDate={section.locked} onPress={openEntry} />,
    [],
  );
  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<ArchiveEntry, Section> }) => (
      <T
        variant="overline"
        color="inkMuted"
        accessibilityRole="header"
        style={{ marginTop: space[6], marginBottom: space[1], marginHorizontal: space[1] }}>
        {section.title}
      </T>
    ),
    [],
  );

  const subtitle = premium === undefined ? undefined : premium ? s.allEditions : s.lastDays(freeDays);
  const header = <AppBar title={s.title} subtitle={subtitle} />;

  if (query.isPending) {
    return (
      <Screen header={header}>
        <Loading />
      </Screen>
    );
  }
  if (!entries) {
    return (
      <Screen header={header}>
        <ErrorState message={s.error} retryLabel={s.retry} onRetry={() => query.refetch()} />
      </Screen>
    );
  }

  let footer: ReactElement | null = null;
  if (locked) {
    footer = <PremiumCallout text={s.callout} cta={s.details} onPress={openPremium} />;
  } else if (premium && entries.length > 0) {
    footer = exhausted ? (
      <T variant="caption" color="inkMuted" align="center" style={{ marginTop: space[6] }}>
        {s.allLoaded}
      </T>
    ) : (
      <View style={{ marginTop: space[4], alignItems: 'center' }}>
        <Button variant="quiet" loading={loadingMore} onPress={loadMore}>
          {s.loadMore}
        </Button>
      </View>
    );
  }

  return (
    <Screen header={header}>
      <SectionList
        sections={sections}
        keyExtractor={keyOf}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        contentContainerStyle={{ paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[8], flexGrow: 1 }}
        ListHeaderComponent={<SearchEntry locked={locked} onPress={openSearch} />}
        ListEmptyComponent={<EmptyState icon={History} title={s.emptyTitle} text={s.emptyText} />}
        ListFooterComponent={footer}
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

const keyOf = (e: ArchiveEntry) => e.id;
