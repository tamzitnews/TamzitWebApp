import { Heart, HeartHandshake } from 'lucide-react-native';
import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Icon, Segmented, T, TextField } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, touchMin } from '@/theme/tokens';
import { DONATE_S } from './strings';

export const DONATION_AMOUNTS = [18, 36, 100, 180] as const;
export type DonationFrequency = 'once' | 'monthly';

const AmountChip = memo(function AmountChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: touchMin,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? c.brand : c.lineStrong,
        backgroundColor: selected ? c.surfaceTint : c.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space[2],
        opacity: pressed ? 0.8 : 1,
      })}>
      <T variant="label" align="center" style={{ writingDirection: 'ltr' }}>
        {label}
      </T>
    </Pressable>
  );
});

/** Donation to Lokchim Achrayut: one-time or monthly, suggested amounts or another amount. */
export function DonationCard({
  onDonate,
  loading,
  error,
}: {
  onDonate: (amount: number, frequency: DonationFrequency) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const { c } = useTheme();
  const s = useStrings(DONATE_S);
  const [frequency, setFrequency] = useState<DonationFrequency>('monthly');
  const [amount, setAmount] = useState<number | 'other'>(36);
  const [other, setOther] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const value = amount === 'other' ? Number(other) : amount;
  const valid = Number.isFinite(value) && value > 0 && value <= 1_000_000;
  const label = !valid ? s.ctaEmpty : frequency === 'monthly' ? s.ctaMonthly(value) : s.cta(value);

  return (
    <View style={{ padding: space[5], borderRadius: radius.lg, backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.line, gap: space[4] }}>
      <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.criticalSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={HeartHandshake} size={22} color="ink" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="headline" accessibilityRole="header">
            {s.cardTitle}
          </T>
          <T variant="caption" color="inkMuted">
            {s.cardText}
          </T>
        </View>
      </View>
      <Segmented<DonationFrequency>
        legend={s.kind}
        value={frequency}
        onChange={setFrequency}
        options={[
          { value: 'once', label: s.once },
          { value: 'monthly', label: s.monthly },
        ]}
      />
      <View accessibilityRole="radiogroup" accessibilityLabel={s.amount} style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.amount}
        </T>
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          {DONATION_AMOUNTS.map((a) => (
            <AmountChip key={a} label={`₪${a}`} selected={amount === a} onPress={() => setAmount(a)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row' }}>
          <AmountChip label={s.other} selected={amount === 'other'} onPress={() => setAmount('other')} />
        </View>
      </View>
      {amount === 'other' ? (
        <TextField
          label={s.otherLabel}
          value={other}
          onChangeText={(t) => setOther(t.replace(/\D/g, '').slice(0, 7))}
          keyboardType="number-pad"
          ltr
          autoFocus
          placeholder="₪"
          error={submitted && !valid ? s.errAmount : undefined}
        />
      ) : null}
      <Button
        block
        size="lg"
        icon={Heart}
        loading={loading}
        onPress={() => {
          setSubmitted(true);
          if (valid) onDonate(value, frequency);
        }}>
        {label}
      </Button>
      {error ? (
        <T variant="caption" color="criticalInk" align="center">
          {error}
        </T>
      ) : null}
    </View>
  );
}
