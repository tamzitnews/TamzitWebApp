import { Redirect } from 'expo-router';
import { useEffect } from 'react';

import { ErrorState, Loading, Screen } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import { useShabbatCity } from '@/features/shabbat/hooks';
import { useMe } from '@/lib/queries';
import { restStatus } from '@/lib/shabbat';
import { usePrefs } from '@/state/prefs';
import { useSession } from '@/state/session';

const S = defineStrings({
  he: { offline: 'אין חיבור לאינטרנט. נסו שוב בעוד רגע.', retry: 'נסו שוב' },
  en: { offline: 'No internet connection. Try again in a moment.', retry: 'Try again' },
  fr: { offline: 'Pas de connexion Internet. Réessayez dans un instant.', retry: 'Réessayer' },
});

/**
 * Entry gate: decides where the app opens.
 * - no session → welcome (first run) or registration (onboarding draft finished)
 * - session, profile not onboarded → onboarding
 * - Shabbat / Yom Tov → Shabbat screen
 * - otherwise → the edition tab
 */
export default function Gate() {
  const { session, loading } = useSession();
  const onboardingDone = usePrefs((s) => s.onboardingDone);
  const me = useMe(!!session);
  const shabbatCity = useShabbatCity();
  const setPrefs = usePrefs((s) => s.set);
  const s = useStrings(S);

  const profile = me.data?.profile;
  useEffect(() => {
    if (!profile) return;
    setPrefs({
      language: profile.language,
      audience: profile.audience,
      topics: profile.topics,
      communities: profile.communities,
      frequency: profile.frequency,
      slotTimes: profile.slot_times,
      levelFilter: profile.level_filter,
      style: profile.style,
      theme: profile.theme,
      textScale: profile.text_scale,
      shabbatCityId: profile.shabbat_city_id,
      onboardingDone: true,
    });
  }, [profile, setPrefs]);

  if (loading) return <Screen><Loading /></Screen>;
  if (!session) return <Redirect href={onboardingDone ? '/auth/register' : '/welcome'} />;
  if (me.isLoading) return <Screen><Loading /></Screen>;
  if (!profile && me.isError) {
    // Offline (or the server is unreachable): local prefs hold a copy of the profile, so an
    // onboarded reader goes straight to the cached edition instead of the welcome screen.
    if (!onboardingDone) return <Screen><ErrorState message={s.offline} onRetry={() => me.refetch()} retryLabel={s.retry} /></Screen>;
    if (restStatus(shabbatCity).resting) return <Redirect href="/shabbat" />;
    return <Redirect href="/(tabs)" />;
  }
  if (!profile) return <Redirect href="/welcome" />;
  if (!profile.onboarded) return <Redirect href="/onboarding/language" />;
  if (restStatus(shabbatCity).resting) return <Redirect href="/shabbat" />;
  return <Redirect href="/(tabs)" />;
}
