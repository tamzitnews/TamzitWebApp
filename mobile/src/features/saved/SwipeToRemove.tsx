import { BookmarkX } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Icon, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

const ACTION_WIDTH = 104;

function RemoveAction({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: ACTION_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[1],
        backgroundColor: c.surfaceTint,
      }}>
      <Icon as={BookmarkX} size={24} color="ink" />
      <T variant="caption" weight={600}>
        {label}
      </T>
    </View>
  );
}

/**
 * Swiping a saved item either way removes it (the bookmark button does the same, and is the
 * accessible path). Both directions act the same, so RTL and LTR need no special handling.
 */
export function SwipeToRemove({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const action = () => <RemoveAction label={label} />;
  return (
    <Swipeable
      friction={1.5}
      leftThreshold={ACTION_WIDTH * 0.8}
      rightThreshold={ACTION_WIDTH * 0.8}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={action}
      renderRightActions={action}
      onSwipeableWillOpen={onRemove}
      childrenContainerStyle={{ backgroundColor: c.surface }}>
      {children}
    </Swipeable>
  );
}
