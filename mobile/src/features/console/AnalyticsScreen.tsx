// "נתוני שימוש": what the operators see about the app (Settings → ניהול → נתוני שימוש, operators only).
// Four readings, in the order a question gets asked: how many people there are and how many still come back, what
// they do with the app, which version is installed, and then the readers themselves, one row each.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { ErrorState, Loading, Segmented, T } from '@/components/ui';
import { SettingsPage } from '@/features/settings/components';
import { api } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import type { Analytics } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const S = defineStrings({
  he: {
    title: 'נתוני שימוש',
    note: 'מה קורה באפליקציה. הנתונים נאספים מהמכשירים של הקוראים ומתעדכנים מיד.',
    window: 'טווח',
    d7: '7 ימים',
    d30: '30 יום',
    d90: '90 יום',
    people: 'אנשים',
    registered: 'נרשמו',
    installed: 'התקינו',
    activeToday: 'פעילים היום',
    active7: 'פעילים ב-7 ימים',
    new7: 'חדשים השבוע',
    atRisk: 'מתרחקים',
    churned: 'נטשו',
    neverOpened: 'לא פתחו אף פעם',
    atRiskNote: 'מתרחק: לא נכנס בין 7 ל-14 יום. נטש: לא נכנס מעל 14 יום.',
    legacy: (n: number) => `${n} פרופילים ישנים מהשירות בוואטסאפ לא נספרים כאן.`,
    use: 'שימוש',
    editionsRead: 'מהדורות שנקראו',
    minutes: 'דקות באפליקציה',
    audio: 'האזנות למבזק',
    audioPeople: (n: number) => `${n} קוראים האזינו`,
    ads: 'לחיצות על פרסומת',
    adsPeople: (n: number) => `${n} קוראים לחצו`,
    saves: 'שמירות',
    shares: 'שיתופים',
    searches: 'חיפושים',
    tour: 'הדרכה',
    tourDone: (done: number, skip: number) => `${done} סיימו את ההדרכה, ${skip} דילגו`,
    versions: 'גרסאות מותקנות',
    devices: (n: number) => (n === 1 ? 'מכשיר אחד' : `${n} מכשירים`),
    readers: 'קוראים',
    readersNote: 'לפי הפעילות האחרונה.',
    never: 'לא נכנס',
    today: 'היום',
    daysAgo: (n: number) => (n === 1 ? 'אתמול' : `לפני ${n} ימים`),
    rowStats: (editions: number, minutes: number, audio: number) => `${editions} מהדורות · ${minutes} דק׳ · ${audio} האזנות`,
    noPush: 'בלי התראות',
    empty: 'אין עדיין נתונים. הם יצטברו ככל שהקוראים ישתמשו באפליקציה.',
    loadError: 'לא הצלחנו לטעון את הנתונים.',
    retry: 'נסו שוב',
  },
  en: {
    title: 'Usage',
    note: 'What happens in the app. The numbers come from the readers’ devices and update right away.',
    window: 'Window',
    d7: '7 days',
    d30: '30 days',
    d90: '90 days',
    people: 'People',
    registered: 'Registered',
    installed: 'Installed',
    activeToday: 'Active today',
    active7: 'Active in 7 days',
    new7: 'New this week',
    atRisk: 'Slipping away',
    churned: 'Churned',
    neverOpened: 'Never opened',
    atRiskNote: 'Slipping away: 7–14 days without opening. Churned: more than 14 days.',
    legacy: (n: number) => `${n} older profiles from the WhatsApp service are not counted here.`,
    use: 'Use',
    editionsRead: 'Editions read',
    minutes: 'Minutes in the app',
    audio: 'Audio plays',
    audioPeople: (n: number) => `${n} readers listened`,
    ads: 'Ad taps',
    adsPeople: (n: number) => `${n} readers tapped`,
    saves: 'Saves',
    shares: 'Shares',
    searches: 'Searches',
    tour: 'Tour',
    tourDone: (done: number, skip: number) => `${done} finished the tour, ${skip} skipped`,
    versions: 'Installed versions',
    devices: (n: number) => (n === 1 ? '1 device' : `${n} devices`),
    readers: 'Readers',
    readersNote: 'By last activity.',
    never: 'Never opened',
    today: 'today',
    daysAgo: (n: number) => (n === 1 ? 'yesterday' : `${n} days ago`),
    rowStats: (editions: number, minutes: number, audio: number) => `${editions} editions · ${minutes} min · ${audio} plays`,
    noPush: 'no notifications',
    empty: 'No data yet. It builds up as readers use the app.',
    loadError: "We couldn't load the data.",
    retry: 'Try again',
  },
  fr: {
    title: 'Utilisation',
    note: "Ce qui se passe dans l'application. Les chiffres viennent des appareils des lecteurs.",
    window: 'Période',
    d7: '7 jours',
    d30: '30 jours',
    d90: '90 jours',
    people: 'Personnes',
    registered: 'Inscrits',
    installed: 'Installations',
    activeToday: "Actifs aujourd'hui",
    active7: 'Actifs sur 7 jours',
    new7: 'Nouveaux cette semaine',
    atRisk: 'Qui s’éloignent',
    churned: 'Partis',
    neverOpened: 'Jamais ouvert',
    atRiskNote: "S'éloignent : 7 à 14 jours sans ouvrir. Partis : plus de 14 jours.",
    legacy: (n: number) => `${n} anciens profils WhatsApp ne sont pas comptés ici.`,
    use: 'Usage',
    editionsRead: 'Éditions lues',
    minutes: 'Minutes dans l’app',
    audio: 'Écoutes',
    audioPeople: (n: number) => `${n} lecteurs ont écouté`,
    ads: 'Clics sur la publicité',
    adsPeople: (n: number) => `${n} lecteurs ont cliqué`,
    saves: 'Enregistrements',
    shares: 'Partages',
    searches: 'Recherches',
    tour: 'Visite guidée',
    tourDone: (done: number, skip: number) => `${done} l'ont terminée, ${skip} l'ont passée`,
    versions: 'Versions installées',
    devices: (n: number) => (n === 1 ? '1 appareil' : `${n} appareils`),
    readers: 'Lecteurs',
    readersNote: 'Par dernière activité.',
    never: 'Jamais ouvert',
    today: "aujourd'hui",
    daysAgo: (n: number) => (n === 1 ? 'hier' : `il y a ${n} jours`),
    rowStats: (editions: number, minutes: number, audio: number) => `${editions} éditions · ${minutes} min · ${audio} écoutes`,
    noPush: 'sans notifications',
    empty: 'Pas encore de données.',
    loadError: 'Chargement impossible.',
    retry: 'Réessayer',
  },
});

/** One number with its label. `tone` marks the ones that need attention. */
function Stat({ value, label, tone }: { value: number | string; label: string; tone?: 'plain' | 'good' | 'warn' | 'bad' }) {
  const { c } = useTheme();
  const color = tone === 'good' ? c.good : tone === 'warn' ? c.sun : tone === 'bad' ? c.critical : c.lineStrong;
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 104,
        backgroundColor: c.surfaceRaised,
        borderWidth: 1,
        borderColor: c.line,
        borderStartWidth: 3,
        borderStartColor: color,
        borderRadius: radius.md,
        paddingVertical: space[2],
        paddingHorizontal: space[3],
        gap: 2,
      }}>
      <T variant="headline" weight={700}>
        {value}
      </T>
      <T variant="caption" color="inkMuted">
        {label}
      </T>
    </View>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <T variant="caption" color="inkMuted" weight={600}>
        {title}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>{children}</View>
      {note ? (
        <T variant="caption" color="inkMuted">
          {note}
        </T>
      ) : null}
    </View>
  );
}

/** Daily people, as a small bar row: the last two weeks, newest on the left (RTL reads right to left). */
function Sparkbars({ data }: { data: Analytics['daily'] }) {
  const { c } = useTheme();
  const max = Math.max(1, ...data.map((d) => d.people));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 48 }}>
      {data.map((d) => (
        <View key={d.day} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
          <View
            style={{
              width: '100%',
              height: Math.max(2, Math.round((d.people / max) * 40)),
              backgroundColor: d.people ? c.brand : c.line,
              borderRadius: 2,
            }}
          />
        </View>
      ))}
    </View>
  );
}

const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null);

export function AnalyticsScreen() {
  const s = useStrings(S);
  const { c } = useTheme();
  const [days, setDays] = useState(30);
  const q = useQuery<Analytics>({ queryKey: ['analytics', days], queryFn: () => api.analytics(days), staleTime: 60_000 });

  if (q.isLoading) {
    return (
      <SettingsPage title={s.title}>
        <Loading />
      </SettingsPage>
    );
  }
  if (q.isError || !q.data) {
    return (
      <SettingsPage title={s.title}>
        <ErrorState message={s.loadError} onRetry={() => q.refetch()} retryLabel={s.retry} />
      </SettingsPage>
    );
  }

  const a = q.data;
  const p = a.people;
  const e = a.engagement;

  return (
    <SettingsPage title={s.title} note={s.note}>
      <Segmented
        legend={s.window}
        value={days}
        onChange={setDays}
        options={[
          { value: 7, label: s.d7 },
          { value: 30, label: s.d30 },
          { value: 90, label: s.d90 },
        ]}
      />

      <Group title={s.people} note={`${s.atRiskNote}${p.legacy_profiles ? ` ${s.legacy(p.legacy_profiles)}` : ''}`}>
        <Stat value={p.registered} label={s.registered} />
        <Stat value={p.with_device} label={s.installed} />
        <Stat value={p.active_today} label={s.activeToday} tone="good" />
        <Stat value={p.active_7d} label={s.active7} tone="good" />
        <Stat value={p.new_7d} label={s.new7} />
        <Stat value={p.at_risk} label={s.atRisk} tone={p.at_risk ? 'warn' : 'plain'} />
        <Stat value={p.churned} label={s.churned} tone={p.churned ? 'bad' : 'plain'} />
        <Stat value={p.never_opened} label={s.neverOpened} tone={p.never_opened ? 'warn' : 'plain'} />
      </Group>

      <View style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.active7}
        </T>
        <Sparkbars data={a.daily} />
      </View>

      <Group title={s.use} note={`${s.audioPeople(e.audio_listeners)} · ${s.adsPeople(e.ad_clickers)}`}>
        <Stat value={e.editions_read} label={s.editionsRead} />
        <Stat value={e.minutes} label={s.minutes} />
        <Stat value={e.audio_plays} label={s.audio} />
        <Stat value={e.ad_clicks} label={s.ads} />
        <Stat value={e.saves} label={s.saves} />
        <Stat value={e.shares} label={s.shares} />
        <Stat value={e.searches} label={s.searches} />
      </Group>

      <Group title={s.tour} note={s.tourDone(e.tour_done, e.tour_skip)}>
        <></>
      </Group>

      <View style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.versions}
        </T>
        {a.versions.map((v) => (
          <View key={`${v.version}:${v.build}`} style={{ flexDirection: 'row', gap: space[2], alignItems: 'baseline' }}>
            <T variant="label" weight={600}>
              {v.version}
            </T>
            <T variant="caption" color="inkMuted">
              {s.devices(v.devices)}
            </T>
          </View>
        ))}
      </View>

      <View style={{ gap: space[3] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.readers}
        </T>
        {a.readers.length === 0 ? (
          <T variant="caption" color="inkMuted">
            {s.empty}
          </T>
        ) : (
          a.readers.map((r, i) => {
            const d = daysSince(r.seen);
            const tone = d === null ? c.lineStrong : d <= 1 ? c.good : d <= 7 ? c.sky : d <= 14 ? c.sun : c.critical;
            return (
              <View
                key={`${r.name}:${i}`}
                style={{ borderStartWidth: 3, borderStartColor: tone, paddingStart: space[3], gap: 2 }}>
                <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <T variant="label" weight={600}>
                    {r.name}
                  </T>
                  <T variant="caption" color="inkMuted">
                    {d === null ? s.never : d === 0 ? s.today : s.daysAgo(d)}
                  </T>
                </View>
                <T variant="caption" color="inkMuted">
                  {s.rowStats(r.editions, r.minutes, r.audio)}
                  {r.version ? ` · ${r.version}` : ''}
                  {r.push ? '' : ` · ${s.noPush}`}
                </T>
              </View>
            );
          })
        )}
      </View>
    </SettingsPage>
  );
}
