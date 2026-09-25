import { Image, type ImageLoadEventData } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink } from 'lucide-react-native';
import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, View, type AccessibilityActionEvent, type ViewStyle } from 'react-native';

import { Icon, T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import type { Ad } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { S } from './strings';

/** Aspect ratio (width / height) held while the image loads. */
const LOADING_RATIO = 16 / 9;
/** Tallest image shown, as height / width; a taller flyer is shown whole, letterboxed on the card. */
const MAX_TALL = 1.25;

/** Adds https:// to a link written without a scheme ("wa.me/…"). */
function withScheme(url: string | null): string | null {
  const u = url?.trim();
  if (!u) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
}

/** "https://www.youtube.com/watch?v=…" → "youtube.com". */
function hostOf(url: string | null): string | null {
  const m = url ? /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url) : null;
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null;
}

/**
 * The single ad of a free edition (design-system AdSlot), placed after the first section. The
 * overline is the ad's own label ("המהדורה בחסות", "תוכן שיווקי", else "פרסומת") next to "remove
 * ads", which leads to Premium. Then the ad's image, the sponsor line, the full text and the link's
 * host. No animation, no tracking. When the ad has a link, the whole card (image included) opens it
 * in the in-app browser; "remove ads" keeps its own tap and is a custom action for screen readers.
 */
export const AdSlot = memo(function AdSlot({ ad }: { ad: Ad }) {
  const { c } = useTheme();
  const s = useStrings(S);
  // Editions cached before the label existed have none.
  const label = ad.label || s.ad;
  const href = useMemo(() => withScheme(ad.link_url), [ad.link_url]);
  const host = useMemo(() => hostOf(href), [href]);

  const open = useCallback(() => {
    if (href) WebBrowser.openBrowserAsync(href).catch(() => {});
  }, [href]);
  const removeAds = useCallback(() => router.push('/premium'), []);
  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'removeAds') removeAds();
      else if (e.nativeEvent.actionName === 'activate') open();
    },
    [open, removeAds],
  );

  const card: ViewStyle = {
    marginTop: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: c.surfaceRaised,
    borderWidth: 1,
    borderColor: c.line,
  };

  const content: ReactNode = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[1] }}>
        <T variant="overline" color="inkMuted" style={{ flexShrink: 1 }}>
          {label}
        </T>
        <Pressable
          accessibilityRole="link"
          onPress={removeAds}
          hitSlop={10}
          style={({ pressed }) => ({ minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <T variant="caption" color="link" weight={600}>
            {s.removeAds}
          </T>
        </Pressable>
      </View>
      {ad.image_url ? <AdImage key={ad.image_url} uri={ad.image_url} label={ad.sponsor ?? label} /> : null}
      {ad.sponsor ? (
        <T variant="label" weight={700}>
          {ad.sponsor}
        </T>
      ) : null}
      {ad.body ? (
        <T
          variant="caption"
          color="inkMuted"
          weight={400}
          numberOfLines={12}
          style={{ fontSize: 15, lineHeight: 22, marginTop: ad.sponsor ? 2 : 0 }}>
          {ad.body}
        </T>
      ) : null}
      {host ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: space[2] }}>
          <T variant="caption" color="link" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
            {host}
          </T>
          <Icon as={ExternalLink} size={14} color="link" strokeWidth={2} />
        </View>
      ) : null}
    </>
  );

  if (!href) return <View style={card}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[ad.sponsor ? s.adOf(label, ad.sponsor) : label, ad.body].filter(Boolean).join('. ')}
      accessibilityHint={host ? s.adOpens(host) : undefined}
      accessibilityActions={[{ name: 'activate' }, { name: 'removeAds', label: s.removeAds }]}
      onAccessibilityAction={onAccessibilityAction}
      onPress={open}
      style={({ pressed }) => [card, { opacity: pressed ? 0.85 : 1 }]}>
      {content}
    </Pressable>
  );
});

/**
 * The ad's image, full width at its natural aspect ratio (16:9 until it has loaded). A flyer taller
 * than MAX_TALL is capped there and shown whole on the card colour; an image that fails is hidden.
 */
const AdImage = memo(function AdImage({ uri, label }: { uri: string; label: string }) {
  const { c } = useTheme();
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const onLoad = useCallback((e: ImageLoadEventData) => {
    const { width, height } = e.source;
    if (width > 0 && height > 0) setRatio(width / height);
  }, []);
  const onError = useCallback(() => setFailed(true), []);
  if (failed) return null;
  const tall = ratio !== null && ratio < 1 / MAX_TALL;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={label}
      contentFit={tall ? 'contain' : 'cover'}
      transition={150}
      cachePolicy="memory-disk"
      onLoad={onLoad}
      onError={onError}
      style={{
        width: '100%',
        aspectRatio: tall ? 1 / MAX_TALL : ratio ?? LOADING_RATIO,
        borderRadius: radius.md,
        // A soft placeholder while loading; then the card colour, so a letterboxed flyer blends in.
        backgroundColor: ratio === null ? c.surface : c.surfaceRaised,
        marginTop: space[2],
        marginBottom: space[3],
      }}
    />
  );
});
