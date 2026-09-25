// Explains notifications before the system prompt: one per edition, at the chosen times.
import { router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Icon, Screen, SquaresMotif, T } from '@/components/ui';
import { defineStrings, EDITION_NAMES, slotEditionType, useLang, useStrings } from '@/lib/i18n';
import { registerForPush } from '@/lib/notifications';
import { usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { CtaArea } from './layout';

const S = defineStrings({
  he: {
    title: 'התראה רק כשהמהדורה מוכנה',
    body: 'נשלח התראה רק כשהמהדורה מוכנה, בשעות שבחרתם. ועדכון מיוחד רק כשקורה משהו חריג.',
    yours: 'המהדורות שלכם',
    allow: 'לאפשר התראות',
    later: 'לא עכשיו',
    note: 'אפשר לשנות בכל עת בהגדרות.',
  },
  en: {
    title: 'A notification only when your edition is ready',
    body: "We'll notify you only when your edition is ready, at the times you chose. And a special update only when something unusual happens.",
    yours: 'Your editions',
    allow: 'Allow notifications',
    later: 'Not now',
    note: 'You can change this at any time in Settings.',
  },
  fr: {
    title: 'Une notification seulement quand l’édition est prête',
    body: 'Nous vous prévenons uniquement quand votre édition est prête, aux heures choisies. Et une mise à jour spéciale seulement en cas d’événement exceptionnel.',
    yours: 'Vos éditions',
    allow: 'Autoriser les notifications',
    later: 'Pas maintenant',
    note: 'Vous pouvez changer cela à tout moment dans les réglages.',
  },
});

export function PermissionsScreen() {
  const s = useStrings(S);
  const lang = useLang();
  const { c } = useTheme();
  const frequency = usePrefs((p) => p.frequency);
  const slotTimes = usePrefs((p) => p.slotTimes);
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    setBusy(true);
    try {
      await registerForPush();
    } catch {
      // Permission or token registration failed: the app works without push; carry on.
    } finally {
      setBusy(false);
      router.replace('/');
    }
  };

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <CtaArea>
          <Button block size="lg" icon={Bell} loading={busy} onPress={allow}>{s.allow}</Button>
          <Button block variant="quiet" disabled={busy} onPress={() => router.replace('/')}>{s.later}</Button>
        </CtaArea>
      }>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: space[6], gap: space[5] }}>
        <SquaresMotif size={80} style={{ position: 'absolute', top: 0, end: 0 }} />
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
          <Icon as={Bell} size={40} color="brand" />
        </View>
        <View style={{ gap: space[3] }}>
          <T variant="display" align="center" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32 }}>{s.title}</T>
          <T variant="body" color="inkMuted" align="center">{s.body}</T>
        </View>
        <View style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space[4], gap: space[2], borderWidth: 1, borderColor: c.line }}>
          <T variant="overline" color="inkMuted">{s.yours}</T>
          {slotTimes.map((t, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <T variant="label" style={{ flex: 1 }}>{EDITION_NAMES[lang][slotEditionType(frequency, i)]}</T>
              <T variant="label" weight={700} style={{ fontVariant: ['tabular-nums'] }}>{t}</T>
            </View>
          ))}
        </View>
        <T variant="caption" color="inkMuted" align="center">{s.note}</T>
      </View>
    </Screen>
  );
}
