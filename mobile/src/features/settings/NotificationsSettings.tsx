import { BellOff } from 'lucide-react-native';
import { useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, Card, Icon, ListGroup, SwitchRow, T } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import { registerForPush } from '@/lib/notifications';
import type { PrefsPatch } from '@/lib/types';
import { space } from '@/theme/tokens';
import { SaveFooter, SettingsPage } from './components';
import { useEffectiveNote, useNotificationPermission, useProfileValues, useSaveProfile } from './hooks';

const S = defineStrings({
  he: {
    title: 'התראות',
    note: 'התראה אחת לכל מהדורה, בשעות שבחרתם. בלי התראות אחרות: לא "חדש", לא "פספסתם" ולא שיווק.',
    edition: 'המהדורה מוכנה',
    editionDesc: 'התראה אחת כשהמהדורה שלכם מוכנה',
    special: 'עדכון מיוחד',
    specialDesc: 'רק באירוע חריג, גם מחוץ לשעות המהדורות',
    headline: 'הכותרת הראשית בהתראה',
    headlineDesc: 'בהתראה על מהדורה או עדכון מיוחד',
    times: (t: string) => `שעות המהדורות: ${t}`,
    shabbat: 'בשבת ובחג אין התראות. מהדורת מוצאי שבת מגיעה אחרי צאת השבת.',
    blocked: 'ההתראות כבויות בהגדרות המכשיר, ולכן לא תגיע אף התראה.',
    openSettings: 'לפתיחת הגדרות המכשיר',
    ask: 'עוד לא אישרתם התראות במכשיר.',
    allow: 'לאישור התראות',
    web: 'התראות זמינות באפליקציה לאנדרואיד.',
    signedOut: 'העדכונים המיוחדים וכותרת בהתראה זמינים אחרי כניסה לחשבון.',
  },
  en: {
    title: 'Notifications',
    note: 'One notification per edition, at the times you chose. No other notifications: no "new", no "you missed", no marketing.',
    edition: 'Edition is ready',
    editionDesc: 'One notification when your edition is ready',
    special: 'Special update',
    specialDesc: 'Only for an exceptional event, even outside edition times',
    headline: 'Main headline in the notification',
    headlineDesc: 'In edition and special update notifications',
    times: (t: string) => `Edition times: ${t}`,
    shabbat: 'No notifications on Shabbat and holidays. The Motzei Shabbat edition arrives after Shabbat ends.',
    blocked: 'Notifications are turned off in your device settings, so none will arrive.',
    openSettings: 'Open device settings',
    ask: 'You haven’t allowed notifications on this device yet.',
    allow: 'Allow notifications',
    web: 'Notifications are available in the Android app.',
    signedOut: 'Special updates and headlines in notifications are available after you sign in.',
  },
  fr: {
    title: 'Notifications',
    note: 'Une notification par édition, aux heures choisies. Aucune autre : pas de « nouveau », pas de « vous avez manqué », pas de marketing.',
    edition: 'Édition prête',
    editionDesc: 'Une notification quand votre édition est prête',
    special: 'Mise à jour spéciale',
    specialDesc: 'Seulement pour un événement exceptionnel, même hors des heures d’édition',
    headline: 'Titre principal dans la notification',
    headlineDesc: 'Dans les notifications d’édition et de mise à jour spéciale',
    times: (t: string) => `Heures des éditions : ${t}`,
    shabbat: 'Aucune notification pendant Chabbat et les fêtes. L’édition de Motsaé Chabbat arrive après la fin de Chabbat.',
    blocked: 'Les notifications sont désactivées dans les réglages de l’appareil : aucune n’arrivera.',
    openSettings: 'Ouvrir les réglages de l’appareil',
    ask: 'Vous n’avez pas encore autorisé les notifications sur cet appareil.',
    allow: 'Autoriser les notifications',
    web: 'Les notifications sont disponibles dans l’application Android.',
    signedOut: 'Les mises à jour spéciales et le titre dans la notification sont disponibles après connexion.',
  },
});

export function NotificationsSettings() {
  const s = useStrings(S);
  const { values, signedIn } = useProfileValues();
  const { save, state } = useSaveProfile();
  const { permission, refresh } = useNotificationPermission();
  const note = useEffectiveNote(values.slot_times, values.frequency);
  const [v, setV] = useState({
    edition_push: values.edition_push,
    special_push: values.special_push,
    headline_in_push: values.headline_in_push,
  });
  const set = (patch: Pick<PrefsPatch, 'edition_push' | 'special_push' | 'headline_in_push'>) => {
    setV((old) => ({ ...old, ...patch }));
    save(patch);
  };

  return (
    <SettingsPage title={s.title} note={s.note} footer={<SaveFooter note={note} state={state} />}>
      {permission === 'denied' || permission === 'undetermined' || permission === 'unavailable' ? (
        <Card tone={permission === 'unavailable' ? 'tint' : 'sun'} style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
            <Icon as={BellOff} size={22} color="ink" />
            <T variant="body" style={{ flex: 1, fontSize: 16, lineHeight: 24 }}>
              {permission === 'denied' ? s.blocked : permission === 'undetermined' ? s.ask : s.web}
            </T>
          </View>
          {permission === 'denied' ? (
            <Button variant="secondary" onPress={() => Linking.openSettings()}>
              {s.openSettings}
            </Button>
          ) : permission === 'undetermined' ? (
            <Button onPress={() => registerForPush().then(refresh)}>{s.allow}</Button>
          ) : null}
        </Card>
      ) : null}

      <ListGroup>
        <SwitchRow label={s.edition} description={s.editionDesc} value={v.edition_push} onValueChange={(x) => set({ edition_push: x })} disabled={!signedIn} />
        <SwitchRow label={s.special} description={s.specialDesc} value={v.special_push} onValueChange={(x) => set({ special_push: x })} disabled={!signedIn} />
        <SwitchRow
          label={s.headline}
          description={s.headlineDesc}
          value={v.headline_in_push}
          onValueChange={(x) => set({ headline_in_push: x })}
          disabled={!signedIn}
        />
      </ListGroup>

      {!signedIn ? (
        <T variant="caption" color="inkMuted">
          {s.signedOut}
        </T>
      ) : null}
      <View style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted">
          {s.times([...values.slot_times].sort().join(' · '))}
        </T>
        <T variant="caption" color="inkMuted">
          {s.shabbat}
        </T>
      </View>
    </SettingsPage>
  );
}
