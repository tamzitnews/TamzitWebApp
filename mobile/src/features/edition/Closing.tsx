// The closing sections of an edition: community label, "ונסיים בטוב", the empty-level note and
// "זהו, אתם מעודכנים".
import { Check, Clock, Sprout, WifiOff } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { Icon, T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import type { FeedItem } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { S } from './strings';

export const CommunityLabel = memo(function CommunityLabel({ name }: { name: string }) {
  const s = useStrings(S);
  return (
    <T
      variant="overline"
      color="inkMuted"
      accessibilityRole="header"
      style={{ marginTop: space[8], marginBottom: -space[2], marginHorizontal: space[1] }}>
      {s.community(name)}
    </T>
  );
});

/** "ונסיים בטוב": the good news that closes every edition, on good-soft with the sprout. */
export const GoodNews = memo(function GoodNews({ item }: { item: FeedItem }) {
  const { c } = useTheme();
  const s = useStrings(S);
  return (
    <View
      accessibilityLabel={s.goodNews}
      style={{ marginTop: space[6], padding: space[5], borderRadius: radius.lg, backgroundColor: c.goodSoft, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] }}>
        <View
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.good, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={Sprout} size={18} color="onGood" strokeWidth={2} />
        </View>
        <T variant="overline" accessibilityRole="header">
          {s.goodNews}
        </T>
      </View>
      <T variant="headline" style={{ marginBottom: space[2] }}>
        {item.headline}
      </T>
      <T variant="body" scaled selectable>
        {item.body}
      </T>
    </View>
  );
});

/** Shown instead of the news when nothing reached the reader's level. */
export const EmptyLevel = memo(function EmptyLevel({ criticalOnly }: { criticalOnly: boolean }) {
  const { c } = useTheme();
  const s = useStrings(S);
  return (
    <View
      style={{
        marginTop: space[4],
        paddingVertical: space[8],
        paddingHorizontal: space[5],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceRaised,
        alignItems: 'center',
        gap: space[2],
      }}>
      <T variant="headline" align="center">
        {criticalOnly ? s.emptyCritical : s.emptyGeneric}
      </T>
      <T variant="caption" color="inkMuted" align="center" style={{ maxWidth: 300 }}>
        {criticalOnly ? s.emptyCriticalText : s.emptyGenericText}
      </T>
    </View>
  );
});

/** "זהו, אתם מעודכנים": the end of the edition, with the next edition's name and time. */
export const EndOfEdition = memo(function EndOfEdition({ next }: { next: { name: string; time: string } | null }) {
  const { c } = useTheme();
  const s = useStrings(S);
  return (
    <View style={{ alignItems: 'center', gap: space[3], paddingTop: space[12], paddingBottom: space[8], paddingHorizontal: space[2] }}>
      <View
        style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon as={Check} size={32} color="brand" strokeWidth={2.25} />
      </View>
      <T variant="title" weight={800} align="center" accessibilityRole="header">
        {s.endTitle}
      </T>
      <T variant="body" color="inkMuted" align="center" style={{ fontSize: 16, lineHeight: 24, maxWidth: 300 }}>
        {s.endText}
      </T>
      {next ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            marginTop: space[2],
            paddingVertical: space[2],
            paddingHorizontal: space[4],
            borderRadius: radius.pill,
            backgroundColor: c.surfaceRaised,
            borderWidth: 1,
            borderColor: c.line,
          }}>
          <Icon as={Clock} size={18} color="ink" />
          <T variant="label" style={{ fontSize: 15, lineHeight: 20 }}>
            {s.next(next.name, next.time)}
          </T>
        </View>
      ) : null}
    </View>
  );
});

/** Small line at the top of the screen when the saved edition is shown without a connection. */
export function OfflineBanner() {
  const { c } = useTheme();
  const s = useStrings(S);
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        marginHorizontal: space[5],
        marginBottom: space[2],
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        backgroundColor: c.sunSoft,
      }}>
      <Icon as={WifiOff} size={18} color="ink" />
      <T variant="caption" style={{ flex: 1 }}>
        {s.offline}
      </T>
    </View>
  );
}
