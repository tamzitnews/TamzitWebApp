import { useEffect, useRef } from 'react';
import { Animated, View, type DimensionValue } from 'react-native';

import { useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { S } from './strings';

/** Loading placeholder shaped like the edition (header + three items), gently pulsing. */
export function EditionSkeleton() {
  const { c } = useTheme();
  const s = useStrings(S);
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const Bar = ({ w, h = 14, mt = 0, r = 6 }: { w: DimensionValue; h?: number; mt?: number; r?: number }) => (
    <View style={{ width: w, height: h, marginTop: mt, borderRadius: r, backgroundColor: c.line }} />
  );

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={s.loading}
      style={{ flex: 1, paddingHorizontal: space[5], paddingTop: space[3], opacity: pulse }}>
      <Bar w="45%" />
      <Bar w="70%" h={30} mt={space[3]} r={8} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[4] }}>
        <Bar w="38%" />
        <View style={{ width: 96, height: 44, borderRadius: radius.pill, backgroundColor: c.line }} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ paddingVertical: space[6], borderBottomWidth: i < 2 ? 1 : 0, borderBottomColor: c.line }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Bar w="30%" h={12} />
            <Bar w={36} h={8} r={0} />
          </View>
          <Bar w="85%" h={18} mt={space[3]} />
          <Bar w="100%" mt={space[3]} />
          <Bar w="92%" mt={space[2]} />
          <Bar w="60%" mt={space[2]} />
        </View>
      ))}
    </Animated.View>
  );
}
