import { BookmarkX } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Icon, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

const THRESHOLD = 88;

function Mark({ label }: { label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space[1], width: 72 }}>
      <Icon as={BookmarkX} size={24} color="ink" />
      <T variant="caption" weight={600}>
        {label}
      </T>
    </View>
  );
}

/**
 * The panel under a swiped row: full width, with the mark at both edges, so whichever side the
 * row slides away from shows it (and a full swipe carries the row off screen).
 */
function RemoveAction({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: space[2],
        backgroundColor: c.surfaceTint,
      }}>
      <Mark label={label} />
      <Mark label={label} />
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
      friction={1.2}
      leftThreshold={THRESHOLD}
      rightThreshold={THRESHOLD}
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
