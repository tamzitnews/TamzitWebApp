import { Star } from 'lucide-react-native';
import { View } from 'react-native';

import { Icon, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

/** "תומך/ת" badge for Premium and Family subscribers: sun pill with a filled star. */
export function SupporterBadge({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        minHeight: 24,
        paddingVertical: 2,
        paddingStart: 8,
        paddingEnd: 10,
        borderRadius: radius.pill,
        backgroundColor: c.sun,
      }}>
      <Icon as={Star} size={14} color="onSun" fill />
      <T variant="overline" color="onSun" weight={800} style={{ lineHeight: 20, letterSpacing: 0 }}>
        {label}
      </T>
    </View>
  );
}
