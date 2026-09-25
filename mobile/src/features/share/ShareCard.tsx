import { Image } from 'expo-image';
import { forwardRef } from 'react';
import { Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { FeedItem } from '@/lib/types';
import { fonts, palette } from '@/theme/tokens';

const logoImg = require('@/assets/brand/tamzit-logo-horizontal.png');

// The card is an image that leaves the app, so it always uses the light palette.
const L = palette.light;

export function shareDate(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/**
 * Design-system ShareCard: a 4:5 image with the logo, topic, headline, body, date and
 * tamzit.org.il, and the squares motif in the corner. Sizes scale with `width` (design width 320).
 */
export const ShareCard = forwardRef<View, { item: FeedItem; width: number; rtl: boolean }>(function ShareCard(
  { item, width, rtl },
  ref,
) {
  const k = width / 320;
  const topic = item.kind === 'community' ? item.community_name ?? item.topic_name : item.topic_name;
  return (
    <View
      ref={ref}
      collapsable={false}
      style={{
        width,
        height: (width * 5) / 4,
        padding: 24 * k,
        borderRadius: 20 * k,
        backgroundColor: L.surfaceRaised,
        overflow: 'hidden',
        gap: 12 * k,
        direction: rtl ? 'rtl' : 'ltr',
      }}>
      <View style={{ position: 'absolute', top: 0, end: 0 }} pointerEvents="none">
        <Svg width={72 * k} height={72 * k} viewBox="0 0 2 2">
          <Rect x={0} y={1} width={1} height={1} fill={L.sky} />
          <Rect x={1} y={0} width={1} height={1} fill={L.surfaceTint} />
        </Svg>
      </View>
      <Image source={logoImg} style={{ height: 40 * k, width: ((40 * 490) / 150) * k }} contentFit="contain" />
      {topic ? (
        <Text style={{ fontFamily: fonts[700], fontSize: 14 * k, lineHeight: 20 * k, color: L.inkMuted, marginTop: 16 * k }}>
          {topic}
        </Text>
      ) : (
        <View style={{ height: 16 * k }} />
      )}
      <Text numberOfLines={4} style={{ fontFamily: fonts[800], fontSize: 24 * k, lineHeight: 32 * k, color: L.ink }}>
        {item.headline}
      </Text>
      <Text numberOfLines={7} style={{ fontFamily: fonts[400], fontSize: 16 * k, lineHeight: 26 * k, color: L.ink }}>
        {item.body}
      </Text>
      <View style={{ marginTop: 'auto', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: fonts[700], fontSize: 13 * k, lineHeight: 18 * k, color: L.inkMuted }}>{shareDate(item.published_at)}</Text>
        <Text style={{ fontFamily: fonts[700], fontSize: 13 * k, lineHeight: 18 * k, color: L.inkMuted, writingDirection: 'ltr' }}>
          tamzit.org.il
        </Text>
      </View>
    </View>
  );
});
