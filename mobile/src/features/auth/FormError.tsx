import { CircleAlert } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, Card, Icon, T } from '@/components/ui';
import { space } from '@/theme/tokens';

/** Form-level error: message and an optional action (e.g. "להתחברות"). Announced to screen readers. */
export function FormError({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <Card tone="critical" style={{ gap: space[3] }}>
      <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
        <Icon as={CircleAlert} size={22} color="criticalInk" />
        <T variant="body" style={{ flex: 1, fontSize: 16, lineHeight: 24 }}>{message}</T>
      </View>
      {action && onAction ? (
        <Button variant="secondary" onPress={onAction} style={{ alignSelf: 'flex-start' }}>{action}</Button>
      ) : null}
    </Card>
  );
}
