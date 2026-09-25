import { Search } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Icon, T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { LockPill } from './LockPill';
import { ArchiveStrings } from './strings';

/**
 * The search field at the top of the archive (design-system SearchField). It is a button: premium
 * readers go to the search screen; free readers see it disabled with the "פרימיום" pill and go to
 * the premium screen.
 */
export function SearchEntry({ locked, onPress }: { locked: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const s = useStrings(ArchiveStrings);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={locked ? `${s.searchLabel}, ${s.premium}` : s.searchLabel}
      accessibilityHint={locked ? s.searchLockedHint : s.searchHint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: locked ? c.line : c.lineStrong,
        backgroundColor: locked ? c.surface : c.surfaceRaised,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingStart: 14,
        paddingEnd: locked ? space[2] : space[4],
        opacity: pressed ? 0.8 : 1,
      })}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], opacity: locked ? 0.6 : 1 }}>
        <Icon as={Search} size={20} color="inkMuted" />
        <T variant="body" color="inkMuted" numberOfLines={1} style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>
          {s.searchPlaceholder}
        </T>
      </View>
      {locked ? <LockPill /> : null}
    </Pressable>
  );
}
