import { useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react-native';
import { memo, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';

import { AppBar, EmptyState, ErrorState, Loading, Screen, T } from '@/components/ui';
import { defineStrings, formatDay, formatTime, useLang, useStrings } from '@/lib/i18n';
import { qk } from '@/lib/queries';
import type { Language } from '@/lib/types';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { markMessagesRead, messagesKey, useMessages, type AppMessage } from './queries';

const S = defineStrings({
  he: {
    title: 'הודעות מהעורכים',
    subtitle: 'תשובות ותיקונים',
    emptyTitle: 'אין הודעות',
    emptyText: 'כשהעורכים יענו על שאלה ששלחתם או יתקנו ידיעה שדיווחתם עליה, ההודעה תופיע כאן.',
    error: 'לא הצלחנו לטעון את ההודעות.',
    retry: 'נסו שוב',
    new: 'חדש',
  },
  en: {
    title: 'Messages from the editors',
    subtitle: 'Replies and corrections',
    emptyTitle: 'No messages',
    emptyText: 'When the editors answer a question you sent or correct an item you reported, the message will appear here.',
    error: 'We couldn’t load your messages.',
    retry: 'Try again',
    new: 'New',
  },
  fr: {
    title: 'Messages de la rédaction',
    subtitle: 'Réponses et corrections',
    emptyTitle: 'Aucun message',
    emptyText: 'Quand la rédaction répondra à une question envoyée ou corrigera une information signalée, le message apparaîtra ici.',
    error: 'Impossible de charger vos messages.',
    retry: 'Réessayer',
    new: 'Nouveau',
  },
});

const MessageCard = memo(function MessageCard({ m, isNew, lang, newLabel }: { m: AppMessage; isNew: boolean; lang: Language; newLabel: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        backgroundColor: c.surfaceRaised,
        borderRadius: radius.lg,
        padding: space[4],
        gap: space[2],
        borderStartWidth: isNew ? 3 : 0,
        borderStartColor: c.brand,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <T variant="caption" color="inkMuted" style={{ flex: 1 }}>
          {`${formatDay(m.created_at, lang)} · ${formatTime(m.created_at)}`}
        </T>
        {isNew ? (
          <T variant="overline" color="brand">
            {newLabel}
          </T>
        ) : null}
      </View>
      <T variant="headline">{m.title}</T>
      <T variant="body" scaled selectable>
        {m.body}
      </T>
    </View>
  );
});

export function MessagesScreen() {
  const s = useStrings(S);
  const lang = useLang();
  const { session, loading } = useSession();
  const q = useMessages(!!session);
  const qc = useQueryClient();
  // Messages that were unread when the screen opened keep their "new" mark until it closes.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const marked = useRef(false);

  useEffect(() => {
    if (!q.data || marked.current) return;
    const unread = q.data.filter((m) => !m.read_at).map((m) => m.id);
    marked.current = true;
    if (!unread.length) return;
    setFresh(new Set(unread));
    markMessagesRead(unread)
      .then(() => {
        qc.invalidateQueries({ queryKey: qk.me });
        qc.invalidateQueries({ queryKey: messagesKey });
      })
      .catch(() => {});
  }, [q.data, qc]);

  const header = <AppBar back title={s.title} subtitle={s.subtitle} />;
  if (loading || q.isLoading)
    return (
      <Screen header={header} edges={['top', 'bottom']}>
        <Loading />
      </Screen>
    );
  if (q.isError && !q.data)
    return (
      <Screen header={header} edges={['top', 'bottom']}>
        <ErrorState message={s.error} retryLabel={s.retry} onRetry={() => q.refetch()} />
      </Screen>
    );

  return (
    <Screen header={header} edges={['top', 'bottom']}>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[8], gap: space[3], flexGrow: 1 }}
        renderItem={({ item }) => <MessageCard m={item} isNew={fresh.has(item.id)} lang={lang} newLabel={s.new} />}
        ListEmptyComponent={<EmptyState icon={Inbox} title={s.emptyTitle} text={s.emptyText} />}
        onRefresh={() => q.refetch()}
        refreshing={q.isRefetching}
      />
    </Screen>
  );
}
