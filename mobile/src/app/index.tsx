import { Redirect } from 'expo-router';
import { useEffect } from 'react';

import { Loading, Screen } from '@/components/ui';
import { useCities, useMe } from '@/lib/queries';
import { restStatus } from '@/lib/shabbat';
import { usePrefs } from '@/state/prefs';
import { useSession } from '@/state/session';

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
  const cities = useCities();
  const setPrefs = usePrefs((s) => s.set);

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
  if (!profile) return <Redirect href="/welcome" />;
  if (!profile.onboarded) return <Redirect href="/onboarding/language" />;
  const city = cities.data?.find((x) => x.id === profile.shabbat_city_id);
  if (restStatus(city).resting) return <Redirect href="/shabbat" />;
  return <Redirect href="/(tabs)" />;
}
