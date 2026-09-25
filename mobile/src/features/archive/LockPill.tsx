import { Lock } from 'lucide-react-native';
import { View } from 'react-native';

import { Icon, T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { ArchiveStrings } from './strings';

/** The small sun-soft "פרימיום" pill with a lock, shown on locked rows and the locked search field. */
export function LockPill() {
  const { c } = useTheme();
  const s = useStrings(ArchiveStrings);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[1],
        paddingHorizontal: space[2],
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: c.sunSoft,
      }}>
      <Icon as={Lock} size={14} color="ink" strokeWidth={2} />
      <T variant="caption" weight={700} style={{ fontSize: 12, lineHeight: 18 }}>
        {s.premium}
      </T>
    </View>
  );
}
