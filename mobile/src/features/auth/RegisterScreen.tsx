// Registration: full name, phone, email (required); birth year and city (optional).
// Sends a 6-digit code to the email, then continues to /auth/verify.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppBar, Button, Screen, T, TextField } from '@/components/ui';
import { backOr, CtaArea, Heading, KeyboardAware } from '@/features/onboarding/layout';
import { auth } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import { normalizePhone } from '@/lib/phone';
import { usePrefs } from '@/state/prefs';
import { space } from '@/theme/tokens';
import { CityField, type CityValue } from './CityField';
import { AUTH_ERRORS, authErrorCode, DEMO_PHONE, type AuthErrorCode } from './errors';
import { FormError } from './FormError';
import { usePendingAuth } from './pending';

const S = defineStrings({
  he: {
    bar: 'הרשמה',
    title: 'כמעט סיימנו',
    subtitle: 'נשמור את ההתאמה שלכם בחשבון. קוד אימות יישלח למייל.',
    name: 'שם מלא',
    namePh: 'ישראל ישראלי',
    phone: 'טלפון נייד',
    phoneHint: 'אותו מספר שבו אתם מקבלים את תמצית החדשות בוואטסאפ, אם יש',
    email: 'אימייל',
    emailHint: 'לכאן נשלח את קוד הכניסה',
    birthYear: 'שנת לידה',
    city: 'עיר מגורים',
    cityHint: 'לזמני שבת וחג',
    optional: '(לא חובה)',
    submit: 'שליחת קוד',
    haveAccount: 'כבר רשומים? כניסה',
    toLogin: 'להתחברות',
    demo: 'כניסה עם חשבון ההדגמה',
    privacy: 'הפרטים משמשים רק לחשבון שלכם. בלי דיוור שיווקי.',
    errName: 'נא למלא שם מלא.',
    errPhone: 'מספר הטלפון לא תקין. נסו בפורמט 050-000-0000.',
    errEmail: 'כתובת המייל לא תקינה.',
    errYear: 'שנת לידה לא תקינה.',
  },
  en: {
    bar: 'Sign up',
    title: 'Almost done',
    subtitle: "We'll save your choices to an account. A verification code will be sent to your email.",
    name: 'Full name',
    namePh: 'Jane Cohen',
    phone: 'Mobile number',
    phoneHint: 'The same number you get Tamzit on WhatsApp with, if you do',
    email: 'Email',
    emailHint: "We'll send your sign-in code here",
    birthYear: 'Year of birth',
    city: 'City',
    cityHint: 'For Shabbat and holiday times',
    optional: '(optional)',
    submit: 'Send code',
    haveAccount: 'Already registered? Sign in',
    toLogin: 'Sign in',
    demo: 'Sign in with the demo account',
    privacy: 'Your details are used only for your account. No marketing emails.',
    errName: 'Please enter your full name.',
    errPhone: 'This phone number is not valid. Try the format 050-000-0000.',
    errEmail: 'This email address is not valid.',
    errYear: 'This year of birth is not valid.',
  },
  fr: {
    bar: 'Inscription',
    title: 'Presque terminé',
    subtitle: 'Nous enregistrons vos choix dans un compte. Un code de vérification sera envoyé par e-mail.',
    name: 'Nom complet',
    namePh: 'Léa Cohen',
    phone: 'Numéro de portable',
    phoneHint: 'Le même numéro que celui où vous recevez Tamzit sur WhatsApp, le cas échéant',
    email: 'E-mail',
    emailHint: 'Nous y enverrons votre code de connexion',
    birthYear: 'Année de naissance',
    city: 'Ville',
    cityHint: 'Pour les horaires de Chabbat et des fêtes',
    optional: '(facultatif)',
    submit: 'Envoyer le code',
    haveAccount: 'Déjà inscrit ? Connexion',
    toLogin: 'Se connecter',
    demo: 'Se connecter avec le compte de démonstration',
    privacy: 'Vos informations servent uniquement à votre compte. Aucun e-mail publicitaire.',
    errName: 'Veuillez indiquer votre nom complet.',
    errPhone: "Ce numéro de téléphone n'est pas valide. Essayez le format 050-000-0000.",
    errEmail: "Cette adresse e-mail n'est pas valide.",
    errYear: "Cette année de naissance n'est pas valide.",
  },
});

type Field = 'name' | 'phone' | 'email' | 'birthYear';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function RegisterScreen() {
  const s = useStrings(S);
  const errors = useStrings(AUTH_ERRORS);
  const params = useLocalSearchParams<{ phone?: string }>();
  const setPrefs = usePrefs((p) => p.set);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState(() => params.phone ?? usePendingAuth.getState().prefillPhone ?? '');
  const [email, setEmail] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [city, setCity] = useState<CityValue | null>(null);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverField, setServerField] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<AuthErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  const year = new Date().getFullYear();
  const invalid: Record<Field, string | undefined> = {
    name: name.trim().length < 2 ? s.errName : undefined,
    phone: normalizePhone(phone) ? undefined : s.errPhone,
    email: EMAIL_RE.test(email.trim()) ? undefined : s.errEmail,
    birthYear:
      birthYear === '' || (/^\d{4}$/.test(birthYear) && +birthYear >= 1900 && +birthYear <= year) ? undefined : s.errYear,
  };
  // Errors show after the first submit, or when leaving a field that has something in it.
  const values: Record<Field, string> = { name, phone, email, birthYear };
  const errorOf = (f: Field) =>
    serverField[f] ?? (submitted || (touched[f] && values[f].trim() !== '') ? invalid[f] : undefined);
  const blur = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));
  const edit = (f: Field, set: (v: string) => void) => (v: string) => {
    set(v);
    if (serverField[f]) setServerField((x) => ({ ...x, [f]: undefined }));
    if (formError) setFormError(null);
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(invalid).some(Boolean)) return;
    const e164 = normalizePhone(phone)!;
    const input = {
      mode: 'register' as const,
      phone: e164,
      full_name: name.trim(),
      email: email.trim().toLowerCase(),
      birth_year: birthYear ? +birthYear : null,
      city: city?.name ?? null,
    };
    setBusy(true);
    try {
      const r = await auth.start(input);
      usePendingAuth.getState().set({ register: input, prefillPhone: null });
      if (city?.id) setPrefs({ shabbatCityId: city.id });
      router.push({ pathname: '/auth/verify', params: { phone: e164, masked_email: r.masked_email, mode: 'register', name: input.full_name } });
    } catch (e) {
      const code = authErrorCode(e);
      if (code === 'invalid_phone') setServerField({ phone: errors.invalid_phone });
      else if (code === 'invalid_email') setServerField({ email: errors.invalid_email });
      else if (code === 'missing_name') setServerField({ name: errors.missing_name });
      else setFormError(code);
    } finally {
      setBusy(false);
    }
  };

  const toLogin = (withPhone: string) => {
    usePendingAuth.getState().set({ prefillPhone: withPhone });
    router.replace({ pathname: '/auth/login', params: { phone: withPhone } });
  };

  const formAction =
    formError === 'already_registered'
      ? { label: s.toLogin, run: () => toLogin(phone) }
      : formError === 'email_not_configured'
        ? { label: s.demo, run: () => toLogin(DEMO_PHONE) }
        : undefined;

  return (
    <KeyboardAware>
      <Screen
        scroll
        edges={['top', 'bottom']}
        scrollProps={{ automaticallyAdjustKeyboardInsets: true }}
        contentStyle={{ gap: space[5], paddingTop: space[2] }}
        header={<AppBar back logo={false} title={s.bar} onBack={() => backOr('/onboarding/style')} />}
        footer={
          <CtaArea>
            <Button block size="lg" loading={busy} onPress={submit}>{s.submit}</Button>
          </CtaArea>
        }>
        <Heading title={s.title} subtitle={s.subtitle} />
        <TextField
          label={s.name}
          value={name}
          onChangeText={edit('name', setName)}
          onBlur={blur('name')}
          error={errorOf('name')}
          placeholder={s.namePh}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <TextField
          label={s.phone}
          value={phone}
          onChangeText={edit('phone', setPhone)}
          onBlur={blur('phone')}
          error={errorOf('phone')}
          hint={s.phoneHint}
          ltr
          placeholder="050-000-0000"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="next"
        />
        <TextField
          label={s.email}
          value={email}
          onChangeText={edit('email', setEmail)}
          onBlur={blur('email')}
          error={errorOf('email')}
          hint={s.emailHint}
          ltr
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <TextField
          label={s.birthYear}
          optional={s.optional}
          value={birthYear}
          onChangeText={edit('birthYear', (v) => setBirthYear(v.replace(/\D/g, '')))}
          onBlur={blur('birthYear')}
          error={errorOf('birthYear')}
          ltr
          placeholder="1990"
          keyboardType="number-pad"
          maxLength={4}
          returnKeyType="done"
        />
        <CityField label={s.city} optional={s.optional} hint={s.cityHint} value={city} onChange={setCity} />
        {formError ? <FormError message={errors[formError]} action={formAction?.label} onAction={formAction?.run} /> : null}
        <View style={{ gap: space[2], alignItems: 'center' }}>
          <T variant="caption" color="inkMuted" align="center">{s.privacy}</T>
          <Button variant="quiet" onPress={() => toLogin(phone)}>{s.haveAccount}</Button>
        </View>
      </Screen>
    </KeyboardAware>
  );
}
