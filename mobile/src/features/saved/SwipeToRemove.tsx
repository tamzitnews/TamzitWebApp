import { BookmarkX } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** How far (px) the row must be dragged before letting go removes it. */
const THRESHOLD = 96;

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
 * Swiping a saved item sideways, either way, removes it; the bookmark button does the same and is
 * the accessible path. The drag is a physical translateX, so it behaves the same in RTL and LTR.
 * The panel under the row shows the "remove" mark at both edges, whichever side is uncovered.
 */
export function SwipeToRemove({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          tx.value = e.translationX;
        })
        .onEnd((e) => {
          const fling = Math.abs(e.velocityX) > 900 && Math.abs(e.translationX) > 32;
          if (Math.abs(e.translationX) > THRESHOLD || fling) {
            const dir = Math.sign(e.translationX || e.velocityX) || 1;
            tx.value = withTiming(dir * width, { duration: 180 }, (done) => {
              if (done) scheduleOnRN(onRemove);
            });
          } else {
            tx.value = withTiming(0, { duration: 180 });
          }
        }),
    [tx, width, onRemove],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const panelStyle = useAnimatedStyle(() => ({ opacity: tx.value === 0 ? 0 : 1 }));

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          StyleSheet.absoluteFill,
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: space[2],
            backgroundColor: c.surfaceTint,
          },
          panelStyle,
        ]}>
        <Mark label={label} />
        <Mark label={label} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: c.surface }, rowStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
