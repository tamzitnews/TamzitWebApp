// First-run welcome. Resumes an onboarding in progress (a language change that flips the text
// direction reloads the app on Android, which restarts at / → /welcome).
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { Button, Logo, Screen, SquaresMotif, T } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { CtaArea } from './layout';
import { STEP_HREF, useOnboardingProgress, useProgressHydrated } from './progress';

const S = defineStrings({
  he: {
    title: 'צורכים חדשות אחרת',
    line: 'כל מה שחשוב, בזמנים קבועים. בלי רעש, בלי סטרס, ובלי לפספס.',
    tagline: 'להתנתק ולהישאר מחובר',
    start: 'בואו נתאים לכם מהדורה',
    login: 'כבר רשומים? כניסה',
  },
  en: {
    title: 'News, differently',
    line: 'Everything that matters, at fixed times. No noise, no stress, and nothing missed.',
    tagline: 'Disconnect and stay informed',
    start: 'Set up your edition',
    login: 'Already registered? Sign in',
  },
  fr: {
    title: 'L’info autrement',
    line: 'Tout ce qui compte, à heures fixes. Sans bruit, sans stress, sans rien manquer.',
    tagline: 'Se déconnecter et rester informé',
    start: 'Composer mon édition',
    login: 'Déjà inscrit ? Connexion',
  },
});

function Tagline({ children }: { children: string }) {
  const { c } = useTheme();
  const rule = { width: 28, height: 2, backgroundColor: c.sky };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <View style={rule} />
      <T variant="label" color="link" weight={700} style={{ fontSize: 17 }}>{children}</T>
      <View style={rule} />
    </View>
  );
}

export function WelcomeScreen() {
  const s = useStrings(S);
  const hydrated = useProgressHydrated();
  const resumed = useRef(false);

  // Continue an onboarding that was interrupted (reload after a direction change, or app restart).
  useEffect(() => {
    if (!hydrated || resumed.current) return;
    resumed.current = true;
    const step = useOnboardingProgress.getState().step;
    if (step && !usePrefs.getState().onboardingDone) router.push(STEP_HREF[step]);
  }, [hydrated]);

  const start = () => {
    useOnboardingProgress.getState().setStep('language');
    router.push(STEP_HREF.language);
  };

  return (
    <Screen
      edges={['top', 'bottom']}
      footer={
        <CtaArea>
          <Button block size="lg" onPress={start}>{s.start}</Button>
          <Button block variant="quiet" onPress={() => router.push('/auth/login')}>{s.login}</Button>
        </CtaArea>
      }>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], paddingHorizontal: space[6], paddingVertical: space[8] }}>
        <SquaresMotif size={96} style={{ position: 'absolute', top: 0, end: 0 }} />
        <SquaresMotif size={64} flip style={{ position: 'absolute', bottom: 0, start: 0 }} />
        <Logo variant="horizontal" height={64} />
        <T variant="display" align="center" accessibilityRole="header" style={{ marginTop: space[4] }}>{s.title}</T>
        <T variant="body" color="inkMuted" align="center" style={{ maxWidth: 300 }}>{s.line}</T>
        <Tagline>{s.tagline}</Tagline>
      </View>
    </Screen>
  );
}
