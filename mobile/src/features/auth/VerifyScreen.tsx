// Enter the 6-digit code sent by email. On success the Supabase session is set; a new account
// gets the onboarding choices saved to its profile and continues to the notification permission.
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';

import { AppBar, Button, Screen, T } from '@/components/ui';
import { useOnboardingProgress } from '@/features/onboarding/progress';
import { backOr, CtaArea, Heading, KeyboardAware } from '@/features/onboarding/layout';
import { api, auth } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import { qk } from '@/lib/queries';
import type { Me } from '@/lib/types';
import { prefsToProfilePatch, usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space } from '@/theme/tokens';
import { AUTH_ERRORS, authErrorCode, type AuthErrorCode } from './errors';
import { FormError } from './FormError';
import { usePendingAuth } from './pending';

const RESEND_SECONDS = 60;
const CODE_LENGTH = 6;

const S = defineStrings({
  he: {
    bar: 'אימות',
    title: 'הזינו את הקוד',
    sent: (m: string) => `שלחנו קוד למייל ${m}`,
    sentGeneric: 'שלחנו קוד למייל שרשום אצלנו',
    codeLabel: 'קוד בן 6 ספרות',
    submit: 'אישור',
    resendIn: (t: string) => `אפשר לשלוח קוד חדש בעוד ${t}`,
    resend: 'שליחת קוד חדש',
    resent: 'שלחנו קוד חדש.',
    spam: 'לא מוצאים את המייל? כדאי לבדוק גם בתיקיית הספאם.',
    saveError: 'נכנסתם לחשבון, אבל לא הצלחנו לשמור את ההגדרות. בדקו את החיבור ונסו שוב.',
    retry: 'נסו שוב',
  },
  en: {
    bar: 'Verification',
    title: 'Enter the code',
    sent: (m: string) => `We sent a code to ${m}`,
    sentGeneric: 'We sent a code to the email address we have on file',
    codeLabel: '6-digit code',
    submit: 'Confirm',
    resendIn: (t: string) => `You can request a new code in ${t}`,
    resend: 'Send a new code',
    resent: 'We sent a new code.',
    spam: "Can't find the email? Check your spam folder too.",
    saveError: "You're signed in, but we couldn't save your settings. Check your connection and try again.",
    retry: 'Try again',
  },
  fr: {
    bar: 'Vérification',
    title: 'Saisissez le code',
    sent: (m: string) => `Nous avons envoyé un code à ${m}`,
    sentGeneric: "Nous avons envoyé un code à l'adresse e-mail enregistrée",
    codeLabel: 'Code à 6 chiffres',
    submit: 'Valider',
    resendIn: (t: string) => `Vous pourrez demander un nouveau code dans ${t}`,
    resend: 'Envoyer un nouveau code',
    resent: 'Nous avons envoyé un nouveau code.',
    spam: 'Vous ne trouvez pas l’e-mail ? Vérifiez aussi vos spams.',
    saveError: "Vous êtes connecté, mais nous n'avons pas pu enregistrer vos réglages. Vérifiez votre connexion et réessayez.",
    retry: 'Réessayer',
  },
});

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function VerifyScreen() {
  const s = useStrings(S);
  const errors = useStrings(AUTH_ERRORS);
  const { c } = useTheme();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ phone?: string; masked_email?: string; mode?: string; name?: string }>();
  const phone = params.phone ?? '';
  const mode = params.mode === 'register' ? 'register' : 'login';

  const input = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [verified, setVerified] = useState(false); // the code was accepted; only saving is left
  const [maskedEmail, setMaskedEmail] = useState(params.masked_email ?? '');
  const [sentAt, setSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // Resend countdown: ticks once a second until it reaches zero.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - sentAt >= RESEND_SECONDS * 1000) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [sentAt]);
  const left = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000));

  /** After the session exists: save the onboarding choices when needed, then leave. */
  const finish = async () => {
    setSaveFailed(false);
    const me = await qc.fetchQuery({ queryKey: qk.me, queryFn: api.me, staleTime: 0 });
    const prefs = usePrefs.getState();
    const savePrefs = mode === 'register' || (!me.profile.onboarded && prefs.onboardingDone);
    if (!savePrefs) {
      // Existing account: the entry gate copies the profile into local prefs and opens the app
      // (or the onboarding, if this account never finished it).
      usePendingAuth.getState().clear();
      router.replace('/');
      return;
    }
    const profile = await api.updateProfile({
      ...prefsToProfilePatch(prefs),
      ...(params.name ? { full_name: params.name } : {}),
      onboarded: true,
    });
    qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, profile } : old));
    qc.invalidateQueries({ queryKey: qk.me });
    usePendingAuth.getState().clear();
    useOnboardingProgress.getState().setStep(null);
    router.replace('/permissions');
  };

  const submit = async (value: string) => {
    if (busy) return;
    setError(null);
    setResent(false);
    setBusy(true);
    try {
      if (!verified) {
        try {
          await auth.verify(phone, value);
        } catch (e) {
          setError(authErrorCode(e));
          setCode('');
          input.current?.focus();
          return;
        }
        setVerified(true);
      }
      try {
        await finish();
      } catch {
        setSaveFailed(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const onChangeCode = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === CODE_LENGTH) submit(digits);
  };

  const resend = async () => {
    setError(null);
    setResent(false);
    setResending(true);
    try {
      const pending = usePendingAuth.getState().register;
      const r = await auth.start(mode === 'register' && pending ? pending : { mode: 'login', phone });
      if (r.masked_email) setMaskedEmail(r.masked_email);
      setSentAt(Date.now());
      setNow(Date.now());
      setCode('');
      setResent(true);
      input.current?.focus();
    } catch (e) {
      setError(authErrorCode(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAware>
      <Screen
        scroll
        edges={['top', 'bottom']}
        scrollProps={{ automaticallyAdjustKeyboardInsets: true }}
        contentStyle={{ gap: space[5], paddingTop: space[2] }}
        header={<AppBar back logo={false} title={s.bar} onBack={() => backOr('/auth/login')} />}
        footer={
          <CtaArea>
            {saveFailed ? (
              <Button block size="lg" loading={busy} onPress={() => submit(code)}>{s.retry}</Button>
            ) : (
              <Button block size="lg" loading={busy} disabled={code.length < CODE_LENGTH} onPress={() => submit(code)}>{s.submit}</Button>
            )}
          </CtaArea>
        }>
        <Heading title={s.title} subtitle={maskedEmail ? s.sent(maskedEmail) : s.sentGeneric} />
        <TextInput
          ref={input}
          value={code}
          onChangeText={onChangeCode}
          autoFocus
          editable={!verified}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          accessibilityLabel={s.codeLabel}
          placeholder="000000"
          placeholderTextColor={c.line}
          selectionColor={c.brand}
          style={{
            minHeight: 72,
            borderRadius: radius.md,
            borderWidth: 2,
            borderColor: error ? c.critical : code.length ? c.brand : c.lineStrong,
            backgroundColor: c.surfaceRaised,
            color: c.ink,
            fontFamily: fonts[700],
            fontSize: 34,
            letterSpacing: 12,
            textAlign: 'center',
            writingDirection: 'ltr',
            fontVariant: ['tabular-nums'],
            // The border already shows focus and errors; no browser outline on web.
            ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null),
          }}
        />
        {error ? <FormError message={errors[error]} /> : null}
        {saveFailed ? <FormError message={s.saveError} /> : null}
        <View style={{ alignItems: 'center', gap: space[2] }}>
          {resent ? <T variant="caption" color="inkMuted" align="center">{s.resent}</T> : null}
          {left > 0 ? (
            <T variant="caption" color="inkMuted" align="center" style={{ fontVariant: ['tabular-nums'] }}>{s.resendIn(mmss(left))}</T>
          ) : (
            <Button variant="quiet" loading={resending} disabled={verified} onPress={resend}>{s.resend}</Button>
          )}
          <T variant="caption" color="inkMuted" align="center">{s.spam}</T>
        </View>
      </Screen>
    </KeyboardAware>
  );
}
