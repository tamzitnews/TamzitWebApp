import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import type { Ad } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { S } from './strings';

/**
 * The single ad of a free edition (design-system AdSlot): labelled "פרסומת", with "remove ads"
 * leading to Premium. No images, no animation, no tracking. Tapping opens the sponsor's link.
 */
export const AdSlot = memo(function AdSlot({ ad }: { ad: Ad }) {
  const { c } = useTheme();
  const s = useStrings(S);
  const open = useCallback(() => {
    if (ad.link_url) WebBrowser.openBrowserAsync(ad.link_url).catch(() => {});
  }, [ad.link_url]);
  return (
    <Pressable
      accessibilityRole={ad.link_url ? 'link' : undefined}
      accessibilityLabel={`${s.adOf(ad.sponsor)}. ${ad.body}`}
      disabled={!ad.link_url}
      onPress={open}
      style={({ pressed }) => ({
        marginTop: space[4],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceRaised,
        borderWidth: 1,
        borderColor: c.line,
        opacity: pressed ? 0.85 : 1,
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[1] }}>
        <T variant="overline" color="inkMuted">
          {s.ad}
        </T>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push('/premium')}
          hitSlop={10}
          style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <T variant="caption" color="link" weight={600}>
            {s.removeAds}
          </T>
        </Pressable>
      </View>
      <T variant="label" weight={700}>
        {ad.sponsor}
      </T>
      <T variant="caption" color="inkMuted" numberOfLines={3} style={{ fontSize: 15, lineHeight: 22, marginTop: 2 }}>
        {ad.body}
      </T>
    </Pressable>
  );
});
