import { Check } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { Button, Icon, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** A plan on the Premium screen: name, price, one short line per feature, and a CTA. */
export const PlanCard = memo(function PlanCard({
  name,
  price,
  features,
  highlighted,
  ribbon,
  cta,
  currentLabel,
  current,
  onPress,
}: {
  name: string;
  price: string;
  features: readonly string[];
  highlighted?: boolean;
  ribbon?: string;
  cta?: string;
  currentLabel: string;
  current?: boolean;
  onPress?: () => void;
}) {
  const { c } = useTheme();
  return (
    <View
      accessibilityLabel={name}
      style={{
        gap: space[3],
        padding: space[5],
        paddingTop: ribbon ? space[6] : space[5],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceRaised,
        borderWidth: highlighted ? 2 : 1.5,
        borderColor: highlighted ? c.brand : c.line,
      }}>
      {ribbon ? (
        <View
          style={{
            position: 'absolute',
            top: -12,
            start: space[5],
            paddingHorizontal: space[3],
            paddingVertical: 2,
            borderRadius: radius.pill,
            backgroundColor: c.sun,
          }}>
          <T variant="overline" color="onSun" weight={800} style={{ lineHeight: 20, letterSpacing: 0 }}>
            {ribbon}
          </T>
        </View>
      ) : null}
      <View>
        <T variant="title" weight={800} style={{ fontSize: 20, lineHeight: 26 }} accessibilityRole="header">
          {name}
        </T>
        <T variant="label" color="inkMuted">
          {price}
        </T>
      </View>
      <View style={{ gap: space[2] }}>
        {features.map((f) => (
          <View key={f} style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
            <View style={{ marginTop: 2 }}>
              <Icon as={Check} size={18} color="brand" strokeWidth={2.25} />
            </View>
            <T variant="body" style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>
              {f}
            </T>
          </View>
        ))}
      </View>
      {cta || current ? (
        <Button block variant={highlighted ? 'primary' : 'secondary'} disabled={current} onPress={onPress}>
          {current ? currentLabel : cta}
        </Button>
      ) : null}
    </View>
  );
});
