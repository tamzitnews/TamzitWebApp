import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Flame } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import { Button, Icon, Screen, SquaresMotif, T } from '@/components/ui';
import { formatTime, localName, useLang, useStrings } from '@/lib/i18n';
import { holidayLabel, motzashEditionAt, restStatus, type RestStatus } from '@/lib/shabbat';
import type { Language } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useRestStatus, useShabbatCity } from './hooks';
import { SHABBAT_S } from './strings';

const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };

/** "20:25", or "יום ראשון, 20:25" when the time is not today. */
function whenLabel(d: Date, lang: Language, now = new Date()) {
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(d);
  const day = new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long' }).format(d);
  return `${day}, ${formatTime(d)}`;
}

function texts(s: typeof SHABBAT_S.he, st: RestStatus) {
  const name = st.holidayName;
  if (name === 'Yom Kippur') return { greeting: s.yomKippur, text: s.textYomKippur };
  if (name === 'Rosh Hashana')
    return st.includesShabbat
      ? { greeting: s.shabbatRoshHashana, text: s.textShabbatChag }
      : { greeting: s.roshHashana, text: s.textChag };
  if (st.kind === 'yomtov')
    return st.includesShabbat ? { greeting: s.shabbatChag, text: s.textShabbatChag } : { greeting: s.chag, text: s.textChag };
  return { greeting: s.shabbat, text: s.textShabbat };
}

/**
 * The Shabbat / Yom Tov screen: shown on every app open between candle lighting and havdalah.
 * Leaves for the entry gate as soon as the rest period ends.
 */
export function ShabbatScreen() {
  const { c } = useTheme();
  const s = useStrings(SHABBAT_S);
  const lang = useLang();
  const city = useShabbatCity();
  const live = useRestStatus(city);
  // Dev-only preview of another moment: /shabbat?at=2026-10-10T12:00:00Z
  const { at } = useLocalSearchParams<{ at?: string }>();
  const preview = useMemo(() => (__DEV__ && at ? restStatus(city, new Date(at)) : null), [at, city]);
  const st = preview ?? live;

  useEffect(() => {
    if (!st.resting) router.replace('/');
  }, [st.resting]);

  const { greeting, text } = texts(s, st);
  const holiday = st.kind === 'yomtov' ? holidayLabel(st.holidayName, lang) : null;
  const cityName = localName(city, lang);
  const isShabbatEnd = st.kind === 'shabbat' || !!st.includesShabbat;
  const edition = st.endsAt ? motzashEditionAt(st.endsAt) : null;

  return (
    <Screen bg="surfaceHero" edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <SquaresMotif size={72} style={{ position: 'absolute', top: 0, end: 0 }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], paddingHorizontal: space[6], paddingVertical: space[8] }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.sun, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={Flame} size={40} color="onSun" />
        </View>
        {holiday ? (
          <T variant="overline" color="onHeroMuted" align="center">
            {holiday}
          </T>
        ) : null}
        <T variant="display" color="onHero" align="center" accessibilityRole="header" style={{ fontSize: 34, lineHeight: 40 }}>
          {greeting}
        </T>
        <T variant="body" color="onHeroMuted" align="center" style={{ maxWidth: 300, lineHeight: 26 }}>
          {text}
        </T>
        {edition && st.endsAt ? (
          <View
            accessible
            style={{
              marginTop: space[2],
              paddingVertical: space[3],
              paddingHorizontal: space[5],
              borderRadius: radius.lg,
              borderWidth: 1.5,
              borderColor: c.lineHero,
              alignItems: 'center',
              gap: 2,
            }}>
            <T variant="caption" color="onHeroMuted" align="center">
              {isShabbatEnd ? s.nextShabbat(cityName) : s.nextChag(cityName)}
            </T>
            <T variant="title" color="onHero" align="center">
              {whenLabel(edition, lang)}
            </T>
            <T variant="caption" color="onHeroMuted" align="center" style={{ fontSize: 13, lineHeight: 18 }}>
              {isShabbatEnd ? s.endsShabbat(formatTime(st.endsAt)) : s.endsChag(formatTime(st.endsAt))}
            </T>
          </View>
        ) : null}
        <Button variant="quiet" onPress={() => router.push('/(tabs)/archive')} style={{ marginTop: space[2] }}>
          <T variant="label" color="onHero" style={{ textDecorationLine: 'underline' }}>
            {s.archive}
          </T>
        </Button>
      </View>
    </Screen>
  );
}
