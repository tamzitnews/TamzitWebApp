import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Lock, Type } from 'lucide-react-native';
import { useCallback } from 'react';
import { View } from 'react-native';

import { AppBar, Button, ErrorState, Icon, IconButton, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { formatTime, useLang, useStrings } from '@/lib/i18n';
import { qk, useUpdateProfile } from '@/lib/queries';
import { usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { OfflineBanner } from './Closing';
import { EditionFeed } from './EditionFeed';
import { EditionSkeleton } from './EditionSkeleton';
import { editionDate, editionName, engineEditionType } from './editionMeta';
import { S } from './strings';
import { usePersonalEdition } from './usePersonalEdition';

const SCALES = [1, 1.15, 1.3];

/** AppBar action: cycles the news text size 1 → 1.15 → 1.3 → 1, locally and on the profile. */
function TextSizeButton() {
  const s = useStrings(S);
  const textScale = usePrefs((st) => st.textScale);
  const setPrefs = usePrefs((st) => st.set);
  const update = useUpdateProfile();
  const cycle = useCallback(() => {
    const i = SCALES.findIndex((x) => Math.abs(x - textScale) < 0.01);
    const next = SCALES[(i + 1) % SCALES.length];
    setPrefs({ textScale: next });
    update.mutate({ text_scale: next });
  }, [textScale, setPrefs, update]);
  return <IconButton icon={Type} label={s.textSize(Math.round(textScale * 100))} onPress={cycle} color="ink" />;
}

/** The "המהדורה" tab: the reader's current personal edition. */
export function EditionTabScreen() {
  const s = useStrings(S);
  const lang = useLang();
  const ed = usePersonalEdition();

  let body;
  if (ed.feed) {
    body = (
      <EditionFeed
        feed={ed.feed}
        type={ed.type}
        name={editionName(ed.type, lang)}
        readKey={ed.readKey}
        refreshing={ed.refreshing}
        onRefresh={ed.refresh}
        banner={ed.offline ? <OfflineBanner /> : null}
      />
    );
  } else if (ed.error) {
    body = <ErrorState message={s.loadError} onRetry={ed.retry} retryLabel={s.retry} />;
  } else {
    body = <EditionSkeleton />;
  }

  return (
    <Screen header={<AppBar title={s.appTitle} actions={<TextSizeButton />} />}>
      {body}
    </Screen>
  );
}

/** One engine edition from the archive (`/edition/[id]`). */
export function EditionViewScreen({ id }: { id: string }) {
  const s = useStrings(S);
  const lang = useLang();
  const q = useQuery({
    queryKey: qk.edition(id),
    queryFn: () => api.editionView(id),
    enabled: !!id,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && ['archive_locked', 'not_found'].includes(e.code)),
  });

  const feed = q.data;
  const type = feed ? engineEditionType(feed) : 'evening';
  const name = feed ? editionName(type, lang, feed.title) : '';
  const subtitle = feed ? `${editionDate(feed.window.to, lang)} · ${formatTime(feed.window.to)}` : undefined;
  const code = q.error instanceof ApiError ? q.error.code : null;

  let body;
  if (feed) {
    body = <EditionFeed feed={feed} type={type} name={name} readKey={id} refreshing={q.isRefetching} onRefresh={() => q.refetch()} />;
  } else if (code === 'archive_locked') {
    body = <LockedEdition />;
  } else if (q.isError) {
    body = <ErrorState message={code === 'not_found' ? s.notFound : s.loadError} onRetry={code === 'not_found' ? undefined : () => q.refetch()} retryLabel={s.retry} />;
  } else {
    body = <EditionSkeleton />;
  }

  return (
    <Screen edges={['top', 'bottom']} header={<AppBar back title={name || undefined} subtitle={subtitle} />}>
      {body}
    </Screen>
  );
}

function LockedEdition() {
  const { c } = useTheme();
  const s = useStrings(S);
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space[5] }}>
      <View style={{ padding: space[6], borderRadius: radius.lg, backgroundColor: c.sunSoft, alignItems: 'center', gap: space[3] }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.sun, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={Lock} size={26} color="onSun" />
        </View>
        <T variant="headline" align="center" accessibilityRole="header">
          {s.lockedTitle}
        </T>
        <T variant="caption" color="ink" align="center">
          {s.lockedText}
        </T>
        <Button variant="sun" onPress={() => router.push('/premium')} style={{ marginTop: space[2] }}>
          {s.lockedCta}
        </Button>
      </View>
    </View>
  );
}
