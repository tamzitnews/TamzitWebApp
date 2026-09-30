// Explains notifications before the system prompt: one when a new edition of the reader's is
// published, and a special update only for an exceptional event.
import { router } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Icon, Screen, SquaresMotif, T } from '@/components/ui';
import { FrequencyEditions } from '@/features/prefs/pickers';
import { defineStrings, useStrings } from '@/lib/i18n';
import { registerForPush } from '@/lib/notifications';
import { usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { CtaArea } from './layout';

const S = defineStrings({
  he: {
    title: 'התראה רק כשיש מהדורה חדשה',
    body: 'נשלח התראה רק כשמהדורה חדשה שלכם עולה. ועדכון מיוחד רק כשקורה משהו חריג.',
    yours: 'המהדורות שלכם',
    allow: 'לאפשר התראות',
    later: 'לא עכשיו',
    note: 'אפשר לשנות בכל עת בהגדרות.',
  },
  en: {
    title: 'A notification only when there’s a new edition',
    body: "We'll notify you only when a new edition of yours is published. And a special update only when something unusual happens.",
    yours: 'Your editions',
    allow: 'Allow notifications',
    later: 'Not now',
    note: 'You can change this at any time in Settings.',
  },
  fr: {
    title: 'Une notification seulement quand une nouvelle édition paraît',
    body: 'Nous vous prévenons uniquement quand une nouvelle édition vous concernant est publiée. Et une mise à jour spéciale seulement en cas d’événement exceptionnel.',
    yours: 'Vos éditions',
    allow: 'Autoriser les notifications',
    later: 'Pas maintenant',
    note: 'Vous pouvez changer cela à tout moment dans les réglages.',
  },
});

export function PermissionsScreen() {
  const s = useStrings(S);
  const { c } = useTheme();
  const frequency = usePrefs((p) => p.frequency);
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
        <FrequencyEditions frequency={frequency} title={s.yours} />
        <T variant="caption" color="inkMuted" align="center">{s.note}</T>
      </View>
    </Screen>
  );
}
