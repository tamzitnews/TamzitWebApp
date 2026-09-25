import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import { MessageCircle, Share2, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Share, useWindowDimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { AppBar, Button, EmptyState, IconButton, Screen, T, useIsRTL } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import { useItemStore } from '@/lib/itemStore';
import type { FeedItem } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { ShareCard } from './ShareCard';

const SITE = 'https://tamzit.org.il';

const S = defineStrings({
  he: {
    title: 'שיתוף הידיעה',
    close: 'סגירה',
    whatsapp: 'שיתוף בוואטסאפ',
    other: 'שיתוף בדרך אחרת',
    note: 'בוואטסאפ הידיעה נשלחת ככרטיס תמונה. בדרך אחרת היא נשלחת כטקסט, עם קישור.',
    noteWeb: 'הידיעה נשלחת כטקסט, עם קישור לתמצית החדשות.',
    dialog: 'שיתוף ידיעה מתמצית החדשות',
    message: (h: string, b: string) => `${h}\n\n${b}\n\nמתוך תמצית החדשות: חדשות בלי רעש ובלי סטרס\n${SITE}`,
    missing: 'הידיעה לא זמינה כרגע',
    missingText: 'חזרו למהדורה ונסו לשתף משם.',
    failed: 'השיתוף לא הצליח. נסו שוב.',
    copied: 'הטקסט הועתק. אפשר להדביק אותו בכל מקום.',
  },
  en: {
    title: 'Share this item',
    close: 'Close',
    whatsapp: 'Share on WhatsApp',
    other: 'Share another way',
    note: 'On WhatsApp the item is sent as an image card. Other ways send it as text, with a link.',
    noteWeb: 'The item is sent as text, with a link to Tamzit News.',
    dialog: 'Share an item from Tamzit News',
    message: (h: string, b: string) => `${h}\n\n${b}\n\nFrom Tamzit News: the news without the noise\n${SITE}`,
    missing: 'This item is not available right now',
    missingText: 'Go back to the edition and share it from there.',
    failed: "Sharing didn't work. Please try again.",
    copied: 'Text copied. You can paste it anywhere.',
  },
  fr: {
    title: 'Partager cet article',
    close: 'Fermer',
    whatsapp: 'Partager sur WhatsApp',
    other: 'Partager autrement',
    note: "Sur WhatsApp, l'article part sous forme d'image. Autrement, il part en texte, avec un lien.",
    noteWeb: "L'article est envoyé en texte, avec un lien vers Tamzit News.",
    dialog: 'Partager un article de Tamzit News',
    message: (h: string, b: string) => `${h}\n\n${b}\n\nVia Tamzit News : l'actualité sans le bruit\n${SITE}`,
    missing: "Cet article n'est pas disponible pour le moment",
    missingText: "Revenez à l'édition et partagez-le depuis là.",
    failed: "Le partage n'a pas fonctionné. Réessayez.",
    copied: 'Texte copié. Vous pouvez le coller où vous voulez.',
  },
});

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)');
}

async function openWhatsAppText(text: string) {
  const q = encodeURIComponent(text);
  const app = `whatsapp://send?text=${q}`;
  if (Platform.OS !== 'web' && (await Linking.canOpenURL(app).catch(() => false))) return Linking.openURL(app);
  return Linking.openURL(`https://wa.me/?text=${q}`);
}

/** `/share/[itemId]`: preview of the share card and the ways to send it. */
export function ShareScreen({ itemId }: { itemId: string }) {
  const { c } = useTheme();
  const s = useStrings(S);
  const rtl = useIsRTL();
  const item = useItemStore((st) => st.byId[itemId]) as FeedItem | undefined;
  const cardRef = useRef<View>(null);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - space[5] * 2, 360);
  const [busy, setBusy] = useState<'whatsapp' | 'other' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const header = (
    <AppBar logo={false} title={s.title} actions={<IconButton icon={X} label={s.close} onPress={close} color="ink" />} />
  );

  if (!item) {
    return (
      <Screen edges={['top', 'bottom']} header={header}>
        <EmptyState icon={Share2} title={s.missing} text={s.missingText}>
          <Button variant="secondary" onPress={close}>
            {s.close}
          </Button>
        </EmptyState>
      </Screen>
    );
  }

  const message = s.message(item.headline, item.body);

  const shareImage = async () => {
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
    const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: s.dialog });
  };

  const onWhatsApp = async () => {
    setNote(null);
    setBusy('whatsapp');
    try {
      if (Platform.OS === 'web') await openWhatsAppText(message);
      else {
        try {
          await shareImage();
        } catch {
          await openWhatsAppText(message);
        }
      }
    } catch {
      setNote(s.failed);
    } finally {
      setBusy(null);
    }
  };

  const onOther = async () => {
    setNote(null);
    setBusy('other');
    try {
      if (Platform.OS === 'web') {
        const nav = (globalThis as { navigator?: Navigator }).navigator;
        if (nav?.share) await nav.share({ title: item.headline, text: message });
        else if (nav?.clipboard) {
          await nav.clipboard.writeText(message);
          setNote(s.copied);
        } else throw new Error('no_share');
      } else {
        await Share.share({ message, title: item.headline, url: Platform.OS === 'ios' ? SITE : undefined }, { dialogTitle: s.dialog });
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setNote(s.failed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} header={header}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingHorizontal: space[5], paddingBottom: space[6], gap: space[5] }}>
        <View
          style={{
            marginTop: space[2],
            borderRadius: 20,
            backgroundColor: c.surfaceRaised,
            shadowColor: '#021330',
            shadowOpacity: 0.16,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}>
          <ShareCard ref={cardRef} item={item} width={cardWidth} rtl={rtl} />
        </View>
        <View style={{ alignSelf: 'stretch', gap: space[3] }}>
          <Button variant="whatsapp" size="lg" block icon={MessageCircle} loading={busy === 'whatsapp'} disabled={!!busy} onPress={onWhatsApp}>
            {s.whatsapp}
          </Button>
          <Button variant="secondary" size="lg" block icon={Share2} loading={busy === 'other'} disabled={!!busy} onPress={onOther}>
            {s.other}
          </Button>
          <T variant="caption" color="inkMuted" align="center" accessibilityRole={note ? 'text' : undefined}>
            {note ?? (Platform.OS === 'web' ? s.noteWeb : s.note)}
          </T>
        </View>
      </ScrollView>
    </Screen>
  );
}
