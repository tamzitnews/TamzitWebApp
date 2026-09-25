import { Flame } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card, Icon, ListGroup, T } from '@/components/ui';
import { BUILTIN_CITIES } from '@/features/shabbat/cities';
import { resolveCity } from '@/features/shabbat/hooks';
import { useRestPeriodsVersion } from '@/features/shabbat/store';
import { defineStrings, formatTime, localName, useLang, useStrings } from '@/lib/i18n';
import { useCities } from '@/lib/queries';
import { holidayLabel, restPeriods } from '@/lib/shabbat';
import type { City, Language } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { SaveFooter, SettingsPage, ValuesGate } from './components';
import { useSaveProfile, type ProfileValues } from './hooks';

const S = defineStrings({
  he: {
    title: 'זמני שבת וחג',
    note: 'מצב שבת וחגים פעיל תמיד, לכל המשתמשים. לפי העיר שתבחרו מחושבים הדלקת הנרות וצאת השבת והחג, ומגיעה מהדורת מוצאי שבת. בחו״ל נכלל גם יום טוב שני של גלויות.',
    israel: 'בישראל',
    abroad: 'בחו״ל',
    now: 'עכשיו',
    shabbat: 'שבת',
    candles: 'הדלקת נרות',
    endsShabbat: 'צאת השבת',
    endsChag: 'צאת החג',
  },
  en: {
    title: 'Shabbat and holiday times',
    note: 'Shabbat and holiday mode is always on, for everyone. Candle lighting, the end of Shabbat and holidays, and the Motzei Shabbat edition follow the city you choose. Outside Israel, the second day of Yom Tov is included.',
    israel: 'In Israel',
    abroad: 'Outside Israel',
    now: 'Now',
    shabbat: 'Shabbat',
    candles: 'Candle lighting',
    endsShabbat: 'Shabbat ends',
    endsChag: 'Holiday ends',
  },
  fr: {
    title: 'Horaires de Chabbat et des fêtes',
    note: 'Le mode Chabbat et fêtes est toujours actif, pour tous. L’allumage des bougies, la fin de Chabbat et des fêtes et l’édition de Motsaé Chabbat suivent la ville choisie. Hors d’Israël, le deuxième jour de fête est inclus.',
    israel: 'En Israël',
    abroad: 'Hors d’Israël',
    now: 'Maintenant',
    shabbat: 'Chabbat',
    candles: 'Allumage des bougies',
    endsShabbat: 'Fin de Chabbat',
    endsChag: 'Fin de la fête',
  },
});

const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };
/** "יום שישי, 17:52" in the city's own time zone. */
function dayTime(d: Date, lang: Language, tz: string) {
  try {
    const day = new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', timeZone: tz }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(d);
    return `${day}, ${time}`;
  } catch {
    return `${new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long' }).format(d)}, ${formatTime(d)}`;
  }
}

const CityRow = memo(function CityRow({
  city,
  selected,
  last,
  onSelect,
}: {
  city: City;
  selected: boolean;
  last: boolean;
  onSelect: (id: string) => void;
}) {
  const { c } = useTheme();
  const lang = useLang();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(city.id)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: 52,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.line,
        opacity: pressed ? 0.7 : 1,
      })}>
      <T variant="label" style={{ flex: 1 }} weight={selected ? 700 : 600}>
        {localName(city, lang)}
      </T>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: selected ? c.brand : c.lineStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand }} /> : null}
      </View>
    </Pressable>
  );
});

function UpcomingTimes({ city }: { city: City }) {
  const s = useStrings(S);
  const lang = useLang();
  const version = useRestPeriodsVersion(city.id);
  const period = useMemo(() => {
    const now = new Date();
    try {
      return restPeriods(city, now, new Date(now.getTime() + 14 * 24 * 3600_000))[0] ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, version]);
  if (!period) return null;
  const active = period.start <= new Date();
  const holiday = period.kind === 'yomtov' ? holidayLabel(period.holidayName, lang) : null;
  const endsLabel = period.includesShabbat ? s.endsShabbat : s.endsChag;
  return (
    <Card tone="tint" style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
      <Icon as={Flame} size={22} color="ink" />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="overline" color="ink">
          {`${active ? `${s.now}: ` : ''}${holiday ?? s.shabbat} · ${localName(city, lang)}`}
        </T>
        <T variant="label">{`${s.candles}: ${dayTime(period.start, lang, city.tzid)}`}</T>
        <T variant="label">{`${endsLabel}: ${dayTime(period.end, lang, city.tzid)}`}</T>
      </View>
    </Card>
  );
}

export function ShabbatCitySettings() {
  const s = useStrings(S);
  return <ValuesGate title={s.title}>{(v) => <ShabbatCityInner values={v} />}</ValuesGate>;
}

function ShabbatCityInner({ values }: { values: ProfileValues }) {
  const s = useStrings(S);
  const { save, state } = useSaveProfile();
  const citiesQ = useCities();
  const cities = citiesQ.data?.length ? citiesQ.data : BUILTIN_CITIES;
  const [id, setId] = useState(values.shabbat_city_id);
  const city = resolveCity(id, citiesQ.data);

  const israel = useMemo(() => cities.filter((x) => x.in_israel), [cities]);
  const abroad = useMemo(() => cities.filter((x) => !x.in_israel), [cities]);
  const onSelect = (next: string) => {
    setId(next);
    save({ shabbat_city_id: next });
  };

  return (
    <SettingsPage title={s.title} note={s.note} footer={<SaveFooter note={null} state={state} />}>
      <UpcomingTimes city={city} />
      <View accessibilityRole="radiogroup">
        <ListGroup label={s.israel}>
          {israel.map((x, i) => (
            <CityRow key={x.id} city={x} selected={x.id === id} last={i === israel.length - 1} onSelect={onSelect} />
          ))}
        </ListGroup>
        <ListGroup label={s.abroad}>
          {abroad.map((x, i) => (
            <CityRow key={x.id} city={x} selected={x.id === id} last={i === abroad.length - 1} onSelect={onSelect} />
          ))}
        </ListGroup>
      </View>
    </SettingsPage>
  );
}
