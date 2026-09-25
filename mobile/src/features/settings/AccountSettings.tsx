import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { LogOut, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, ErrorState, ListGroup, ListRow, Loading, T, TextField } from '@/components/ui';
import { CityField, type CityValue } from '@/features/auth/CityField';
import { defineStrings, localName, useLang, useStrings } from '@/lib/i18n';
import { cancelEditionNotifications } from '@/lib/notifications';
import { useAppSettings, useCities } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { ConfirmSheet, SettingsPage } from './components';
import { formatPhone, useProfileValues, useSaveProfile } from './hooks';

const S = defineStrings({
  he: {
    title: 'פרטים אישיים',
    name: 'שם מלא',
    email: 'אימייל',
    emailHint: 'לשינוי האימייל כתבו לנו.',
    phone: 'טלפון',
    phoneHint: 'הכניסה לאפליקציה היא לפי מספר הטלפון.',
    birthYear: 'שנת לידה',
    city: 'עיר מגורים',
    optional: '(לא חובה)',
    save: 'שמירה',
    saved: 'נשמר',
    errName: 'נא לכתוב שם מלא',
    errYear: 'שנת לידה לא תקינה',
    saveError: 'לא הצלחנו לשמור. נסו שוב.',
    contact: 'לכתוב לנו',
    signOut: 'יציאה מהחשבון',
    signOutTitle: 'לצאת מהחשבון?',
    signOutText: 'ההגדרות שלכם נשמרות בחשבון. כדי לחזור, נכנסים שוב עם מספר הטלפון.',
    delete: 'מחיקת החשבון',
    deleteTitle: 'למחוק את החשבון?',
    deleteText: 'נפתח מייל לצוות עם בקשת המחיקה. אחרי אימות, החשבון וכל הנתונים שלו יימחקו. מנוי בחנות מבטלים בהגדרות החנות.',
    deleteConfirm: 'לשליחת בקשת מחיקה',
    cancel: 'ביטול',
    deleteSubject: 'בקשה למחיקת חשבון בתמצית החדשות',
    deleteBody: (phone: string, email: string) =>
      `שלום,\nאבקש למחוק את החשבון שלי באפליקציית תמצית החדשות ואת כל הנתונים שלו.\n\nטלפון: ${phone}\nאימייל: ${email}\n\nתודה`,
    emailSubject: 'שינוי אימייל בחשבון תמצית החדשות',
    loadError: 'לא הצלחנו לטעון את הפרטים.',
    retry: 'נסו שוב',
  },
  en: {
    title: 'Personal details',
    name: 'Full name',
    email: 'Email',
    emailHint: 'To change your email, write to us.',
    phone: 'Phone',
    phoneHint: 'You sign in to the app with your phone number.',
    birthYear: 'Year of birth',
    city: 'City',
    optional: '(optional)',
    save: 'Save',
    saved: 'Saved',
    errName: 'Please enter your full name',
    errYear: 'Invalid year of birth',
    saveError: 'We couldn’t save. Please try again.',
    contact: 'Write to us',
    signOut: 'Sign out',
    signOutTitle: 'Sign out?',
    signOutText: 'Your settings stay in your account. To come back, sign in again with your phone number.',
    delete: 'Delete account',
    deleteTitle: 'Delete your account?',
    deleteText: 'We’ll open an email to our team with the deletion request. After verification, the account and all its data will be deleted. Store subscriptions are cancelled in the store settings.',
    deleteConfirm: 'Send deletion request',
    cancel: 'Cancel',
    deleteSubject: 'Tamzit account deletion request',
    deleteBody: (phone: string, email: string) =>
      `Hello,\nPlease delete my Tamzit app account and all of its data.\n\nPhone: ${phone}\nEmail: ${email}\n\nThank you`,
    emailSubject: 'Change of email on my Tamzit account',
    loadError: 'We couldn’t load your details.',
    retry: 'Try again',
  },
  fr: {
    title: 'Informations personnelles',
    name: 'Nom complet',
    email: 'E-mail',
    emailHint: 'Pour changer d’e-mail, écrivez-nous.',
    phone: 'Téléphone',
    phoneHint: 'La connexion à l’application se fait avec votre numéro de téléphone.',
    birthYear: 'Année de naissance',
    city: 'Ville',
    optional: '(facultatif)',
    save: 'Enregistrer',
    saved: 'Enregistré',
    errName: 'Veuillez indiquer votre nom complet',
    errYear: 'Année de naissance invalide',
    saveError: 'Échec de l’enregistrement. Veuillez réessayer.',
    contact: 'Nous écrire',
    signOut: 'Se déconnecter',
    signOutTitle: 'Se déconnecter ?',
    signOutText: 'Vos réglages restent dans votre compte. Pour revenir, reconnectez-vous avec votre numéro de téléphone.',
    delete: 'Supprimer le compte',
    deleteTitle: 'Supprimer votre compte ?',
    deleteText: 'Nous ouvrirons un e-mail à notre équipe avec la demande de suppression. Après vérification, le compte et toutes ses données seront supprimés. Les abonnements se résilient dans les réglages du store.',
    deleteConfirm: 'Envoyer la demande',
    cancel: 'Annuler',
    deleteSubject: 'Demande de suppression de compte Tamzit',
    deleteBody: (phone: string, email: string) =>
      `Bonjour,\nMerci de supprimer mon compte de l’application Tamzit et toutes ses données.\n\nTéléphone : ${phone}\nE-mail : ${email}\n\nMerci`,
    emailSubject: 'Changement d’e-mail sur mon compte Tamzit',
    loadError: 'Impossible de charger vos informations.',
    retry: 'Réessayer',
  },
});

export const FALLBACK_SUPPORT_EMAIL = 'support@tamzit.org.il';

/** The support address from app_settings (fallback: support@tamzit.org.il). */
export function useSupportEmail() {
  const settings = useAppSettings();
  const v = settings.data?.support_email;
  return typeof v === 'string' && v.includes('@') ? v : FALLBACK_SUPPORT_EMAIL;
}

export function mailto(to: string, subject: string, body?: string) {
  const q = [`subject=${encodeURIComponent(subject)}`, body ? `body=${encodeURIComponent(body)}` : null].filter(Boolean).join('&');
  return Linking.openURL(`mailto:${to}?${q}`).catch(() => {});
}

/** A read-only field: label above, value (left-to-right) below. */
function ReadOnlyRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { c } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ minHeight: 60, paddingVertical: space[2], justifyContent: 'center', borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <T variant="caption" color="inkMuted" weight={600}>
        {label}
      </T>
      <T variant="label" style={{ writingDirection: 'ltr', alignSelf: 'flex-start' }}>
        {value}
      </T>
    </View>
  );
}

function AccountForm({ profile }: { profile: Profile }) {
  const s = useStrings(S);
  const lang = useLang();
  const cities = useCities();
  const { save, state } = useSaveProfile();
  const support = useSupportEmail();
  const qc = useQueryClient();

  const [name, setName] = useState(profile.full_name ?? '');
  const [year, setYear] = useState(profile.birth_year ? String(profile.birth_year) : '');
  // undefined = not edited: shows the saved city (a free-text name, or a city id from older data).
  const [cityEdit, setCityEdit] = useState<CityValue | null | undefined>(undefined);
  const savedCity: CityValue | null = useMemo(() => {
    if (!profile.city) return null;
    const match = cities.data?.find((x) => [x.name_he, x.name_en, x.name_fr, x.id].includes(profile.city!));
    return { name: match ? localName(match, lang) : profile.city, id: match?.id ?? null };
  }, [profile.city, cities.data, lang]);
  const city = cityEdit === undefined ? savedCity : cityEdit;
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<'signout' | 'delete' | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const thisYear = new Date().getFullYear();
  const errName = name.trim().length < 2 ? s.errName : undefined;
  const errYear = year === '' || (/^\d{4}$/.test(year) && +year >= 1900 && +year <= thisYear) ? undefined : s.errYear;
  const dirty =
    name.trim() !== (profile.full_name ?? '').trim() ||
    (year ? +year : null) !== (profile.birth_year ?? null) ||
    (cityEdit !== undefined && (cityEdit?.name ?? null) !== (profile.city ?? null));

  const submit = async () => {
    setSubmitted(true);
    if (errName || errYear) return;
    const ok = await save({
      full_name: name.trim(),
      birth_year: year ? +year : null,
      ...(cityEdit !== undefined ? { city: cityEdit?.name ?? null } : {}),
    });
    if (ok) setCityEdit(undefined);
  };

  const signOut = async () => {
    setSigningOut(true);
    await cancelEditionNotifications().catch(() => {});
    // Only this device: the reader stays signed in on their other devices.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    qc.clear();
    setConfirm(null);
    router.replace('/');
  };

  const phone = formatPhone(profile.phone);

  return (
    <View style={{ gap: space[5] }}>
      <TextField label={s.name} value={name} onChangeText={setName} autoComplete="name" textContentType="name" error={submitted ? errName : undefined} />
      <View style={{ gap: space[2] }}>
        <ListGroup>
          <ReadOnlyRow label={s.email} value={profile.email} />
          <ReadOnlyRow label={s.phone} value={phone} last />
        </ListGroup>
        <T variant="caption" color="inkMuted" style={{ marginHorizontal: space[1] }}>
          {`${s.phoneHint} ${s.emailHint}`}
        </T>
        <Button variant="quiet" style={{ alignSelf: 'flex-start' }} onPress={() => mailto(support, s.emailSubject)}>
          {s.contact}
        </Button>
      </View>
      <TextField
        label={s.birthYear}
        optional={s.optional}
        value={year}
        onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        ltr
        error={submitted ? errYear : undefined}
      />
      <CityField label={s.city} optional={s.optional} value={city} onChange={setCityEdit} />
      <View style={{ gap: space[2] }}>
        <Button block size="lg" onPress={submit} disabled={!dirty} loading={state === 'saving'}>
          {state === 'saved' && !dirty ? s.saved : s.save}
        </Button>
        {state === 'error' ? (
          <T variant="caption" color="criticalInk" align="center">
            {s.saveError}
          </T>
        ) : null}
      </View>

      <ListGroup>
        <ListRow icon={LogOut} title={s.signOut} onPress={() => setConfirm('signout')} chevron={false} />
        <ListRow icon={Trash2} title={s.delete} onPress={() => setConfirm('delete')} chevron={false} destructive last />
      </ListGroup>

      <ConfirmSheet
        visible={confirm === 'signout'}
        title={s.signOutTitle}
        text={s.signOutText}
        confirm={s.signOut}
        cancel={s.cancel}
        loading={signingOut}
        onConfirm={signOut}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === 'delete'}
        title={s.deleteTitle}
        text={s.deleteText}
        confirm={s.deleteConfirm}
        cancel={s.cancel}
        onConfirm={() => {
          setConfirm(null);
          mailto(support, s.deleteSubject, s.deleteBody(profile.phone, profile.email));
        }}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

export function AccountSettings() {
  const s = useStrings(S);
  const { me, signedIn, sessionLoading } = useProfileValues();
  const profile = me.data?.profile;
  return (
    <SettingsPage title={s.title}>
      {sessionLoading || (signedIn && me.isLoading) ? (
        <Loading />
      ) : profile ? (
        <AccountForm profile={profile} />
      ) : (
        <ErrorState message={s.loadError} retryLabel={s.retry} onRetry={() => (signedIn ? me.refetch() : router.replace('/'))} />
      )}
    </SettingsPage>
  );
}
