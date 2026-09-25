import { View } from 'react-native';

import { Button, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** Sun-soft strip with a short line and a sun "לפרטים" button (archive footer for free readers). */
export function PremiumCallout({ text, cta, onPress }: { text: string; cta: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        marginTop: space[4],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: c.sunSoft,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
      }}>
      <T variant="caption" color="ink" weight={600} style={{ flex: 1 }}>
        {text}
      </T>
      <Button variant="sun" onPress={onPress} accessibilityLabel={`${cta}: ${text}`} style={{ paddingHorizontal: space[4] }}>
        {cta}
      </Button>
    </View>
  );
}
