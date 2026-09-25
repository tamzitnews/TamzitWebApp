import { Flame, Headphones, Megaphone, Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { Button, Icon, T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import type { EditionType } from '@/lib/types';
import { space } from '@/theme/tokens';
import { S } from './strings';

export const EDITION_ICONS: Record<EditionType, LucideIcon> = {
  morning: Sunrise,
  noon: Sun,
  evening: Moon,
  erev_shabbat: Flame,
  motzash: Flame,
  special: Megaphone,
};

/** Design-system EditionHeader: day and date, edition name, count and reading time, "listen". */
export const EditionHeader = memo(function EditionHeader({
  type,
  name,
  date,
  count,
  minutes,
  onListen,
}: {
  type: EditionType;
  name: string;
  date: string;
  count: number;
  minutes: number;
  onListen?: () => void;
}) {
  const s = useStrings(S);
  return (
    <View style={{ gap: space[2], paddingTop: space[3], paddingBottom: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Icon as={EDITION_ICONS[type]} size={18} color="inkMuted" />
        <T variant="caption" color="inkMuted" weight={600}>
          {date}
        </T>
      </View>
      <T variant="display" accessibilityRole="header">
        {name}
      </T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[3],
          marginTop: space[2],
          minHeight: 44,
        }}>
        <T variant="caption" color="inkMuted" style={{ flexShrink: 1 }}>
          {count > 0 ? s.meta(count, minutes) : ''}
        </T>
        {onListen ? (
          <Button variant="secondary" icon={Headphones} onPress={onListen}>
            {s.listen}
          </Button>
        ) : null}
      </View>
    </View>
  );
});
