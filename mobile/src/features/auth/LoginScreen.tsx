// Sign in with the phone number; a 6-digit code goes to the email registered for it.
import { router, useLocalSearchParams } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AppBar, Button, Card, Icon, Screen, T, TextField } from '@/components/ui';
import { STEP_HREF, useOnboardingProgress } from '@/features/onboarding/progress';
import { backOr, CtaArea, Heading, KeyboardAware } from '@/features/onboarding/layout';
import { auth } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { usePrefs } from '@/state/prefs';
import { space } from '@/theme/tokens';
import { AUTH_ERRORS, authErrorCode, DEMO_PHONE, type AuthErrorCode } from './errors';
import { FormError } from './FormError';
import { usePendingAuth } from './pending';

const S = defineStrings({
  he: {
    bar: 'כניסה',
    title: 'ברוכים השבים',
    subtitle: 'הזינו את מספר הטלפון שאיתו נרשמתם.',
    phone: 'טלפון נייד',
    note: 'נשלח קוד בן 6 ספרות למייל שרשום אצלנו.',
    submit: 'שליחת קוד',
    toRegister: 'להרשמה',
    demo: 'כניסה עם חשבון ההדגמה',
    noAccount: 'עוד לא רשומים? בואו נתאים לכם מהדורה',
    errPhone: 'מספר הטלפון לא תקין. נסו בפורמט 050-000-0000.',
  },
  en: {
    bar: 'Sign in',
    title: 'Welcome back',
    subtitle: 'Enter the phone number you registered with.',
    phone: 'Mobile number',
    note: "We'll send a 6-digit code to the email address we have on file.",
    submit: 'Send code',
    toRegister: 'Sign up',
    demo: 'Sign in with the demo account',
    noAccount: 'Not registered yet? Set up your edition',
    errPhone: 'This phone number is not valid. Try the format 050-000-0000.',
  },
  fr: {
    bar: 'Connexion',
    title: 'Bon retour',
    subtitle: 'Indiquez le numéro de téléphone utilisé lors de votre inscription.',
    phone: 'Numéro de portable',
    note: "Nous enverrons un code à 6 chiffres à l'adresse e-mail enregistrée.",
    submit: 'Envoyer le code',
    toRegister: "S'inscrire",
    demo: 'Se connecter avec le compte de démonstration',
    noAccount: 'Pas encore inscrit ? Composez votre édition',
    errPhone: "Ce numéro de téléphone n'est pas valide. Essayez le format 050-000-0000.",
  },
});

export function LoginScreen() {
  const s = useStrings(S);
  const errors = useStrings(AUTH_ERRORS);
  const params = useLocalSearchParams<{ phone?: string }>();
  const [phone, setPhone] = useState(() => {
    const p = params.phone ?? usePendingAuth.getState().prefillPhone ?? '';
    const e164 = normalizePhone(p);
    return e164 ? formatPhone(e164) : p;
  });
  const [submitted, setSubmitted] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<AuthErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  const invalid = normalizePhone(phone) ? undefined : s.errPhone;
  const error = fieldError ?? (submitted ? invalid : undefined);

  const send = async (raw: string) => {
    setSubmitted(true);
    setFormError(null);
    setFieldError(undefined);
    const e164 = normalizePhone(raw);
    if (!e164) return;
    setBusy(true);
    try {
      const r = await auth.start({ mode: 'login', phone: e164 });
      router.push({ pathname: '/auth/verify', params: { phone: e164, masked_email: r.masked_email, mode: 'login' } });
    } catch (e) {
      const code = authErrorCode(e);
      if (code === 'invalid_phone') setFieldError(errors.invalid_phone);
      else setFormError(code);
    } finally {
      setBusy(false);
    }
  };

  // Not registered: registration needs the onboarding choices first.
  const toRegister = () => {
    usePendingAuth.getState().set({ prefillPhone: phone });
    if (usePrefs.getState().onboardingDone) {
      router.replace({ pathname: '/auth/register', params: { phone } });
    } else {
      useOnboardingProgress.getState().setStep('language');
      router.replace(STEP_HREF.language);
    }
  };

  const signInDemo = () => {
    setPhone(formatPhone(normalizePhone(DEMO_PHONE)!));
    send(DEMO_PHONE);
  };

  const formAction =
    formError === 'not_registered'
      ? { label: s.toRegister, run: toRegister }
      : formError === 'email_not_configured'
        ? { label: s.demo, run: signInDemo }
        : undefined;

  return (
    <KeyboardAware>
      <Screen
        scroll
        edges={['top', 'bottom']}
        scrollProps={{ automaticallyAdjustKeyboardInsets: true }}
        contentStyle={{ gap: space[5], paddingTop: space[2] }}
        header={<AppBar back logo={false} title={s.bar} onBack={() => backOr('/welcome')} />}
        footer={
          <CtaArea>
            <Button block size="lg" loading={busy} onPress={() => send(phone)}>{s.submit}</Button>
          </CtaArea>
        }>
        <Heading title={s.title} subtitle={s.subtitle} />
        <TextField
          label={s.phone}
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            setFieldError(undefined);
            setFormError(null);
          }}
          error={error}
          ltr
          autoFocus
          placeholder="050-000-0000"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="send"
          onSubmitEditing={() => send(phone)}
        />
        <Card tone="tint" style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
          <Icon as={Mail} size={22} color="brand" />
          <T variant="caption" style={{ flex: 1, fontSize: 15, lineHeight: 22 }}>{s.note}</T>
        </Card>
        {formError ? <FormError message={errors[formError]} action={formAction?.label} onAction={formAction?.run} /> : null}
        <View style={{ alignItems: 'center' }}>
          <Button variant="quiet" onPress={toRegister}>{s.noAccount}</Button>
        </View>
      </Screen>
    </KeyboardAware>
  );
}
