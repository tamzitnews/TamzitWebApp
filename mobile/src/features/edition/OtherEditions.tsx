// Editions that came out after the one the reader gets, and are not theirs: a reader on one or two editions a day
// sees yesterday's edition all day, and without this line that looks like an app that stopped working.
import { Newspaper } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { Icon, T } from '@/components/ui';
import { EDITION_NAMES, useLang, useStrings } from '@/lib/i18n';
import type { Feed } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { S } from './strings';

type Other = NonNullable<Feed['other_editions']>[number];

export const OtherEditions = memo(function OtherEditions({ editions }: { editions: Other[] }) {
  const s = useStrings(S);
  const lang = useLang();
  const { c } = useTheme();
  if (!editions.length) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: space[2],
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        backgroundColor: c.surfaceRaised,
        borderWidth: 1,
        borderColor: c.line,
      }}>
      <Icon as={Newspaper} size={16} color="inkMuted" />
      <T variant="caption" color="inkMuted" style={{ flexShrink: 1 }}>
        {s.alsoOut}
      </T>
      {editions.map((e) => {
        const name = e.title?.trim() || EDITION_NAMES[lang][e.kind];
        return (
          <Pressable
            key={e.id}
            accessibilityRole="link"
            accessibilityLabel={s.openEdition(name)}
            hitSlop={8}
            onPress={() => router.push({ pathname: '/edition/[id]', params: { id: e.id } })}>
            <T variant="caption" color="link" weight={600}>
              {name}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
});
