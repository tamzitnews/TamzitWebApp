// Messages for the auth edge functions' error codes (docs/api-contract.md) and network failures.
import { ApiError } from '@/lib/api';
import { defineStrings } from '@/lib/i18n';

export type AuthErrorCode =
  | 'already_registered'
  | 'not_registered'
  | 'invalid_phone'
  | 'invalid_email'
  | 'missing_name'
  | 'rate_limited'
  | 'email_not_configured'
  | 'invalid_code'
  | 'expired'
  | 'not_found'
  | 'network'
  | 'generic';

const KNOWN = new Set<string>([
  'already_registered',
  'not_registered',
  'invalid_phone',
  'invalid_email',
  'missing_name',
  'rate_limited',
  'email_not_configured',
  'invalid_code',
  'expired',
  'not_found',
]);

/** Maps anything thrown by `auth.start` / `auth.verify` / RPCs to a message key. */
export function authErrorCode(e: unknown): AuthErrorCode {
  if (e instanceof ApiError) return KNOWN.has(e.code) ? (e.code as AuthErrorCode) : 'generic';
  // fetch() rejects with a TypeError when there is no connection.
  return 'network';
}

export const AUTH_ERRORS = defineStrings<Record<AuthErrorCode, string>>({
  he: {
    already_registered: 'המספר הזה כבר רשום אצלנו. אפשר פשוט להתחבר.',
    not_registered: 'המספר הזה עוד לא רשום אצלנו.',
    invalid_phone: 'מספר הטלפון לא תקין. נסו בפורמט 050-000-0000.',
    invalid_email: 'כתובת המייל לא תקינה.',
    missing_name: 'נא למלא שם מלא.',
    rate_limited: 'היו יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.',
    email_not_configured: 'שליחת קודים במייל עוד לא הוגדרה. אפשר להיכנס עם חשבון ההדגמה.',
    invalid_code: 'הקוד לא נכון. בדקו אותו ונסו שוב.',
    expired: 'תוקף הקוד פג. שלחו קוד חדש.',
    not_found: 'לא מצאנו בקשת כניסה פעילה למספר הזה. שלחו קוד חדש.',
    network: 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.',
    generic: 'משהו השתבש אצלנו. נסו שוב בעוד רגע.',
  },
  en: {
    already_registered: 'This number is already registered. You can simply sign in.',
    not_registered: "This number isn't registered yet.",
    invalid_phone: 'This phone number is not valid. Try the format 050-000-0000.',
    invalid_email: 'This email address is not valid.',
    missing_name: 'Please enter your full name.',
    rate_limited: 'Too many attempts. Please try again in a few minutes.',
    email_not_configured: 'Sending codes by email is not set up yet. You can sign in with the demo account.',
    invalid_code: 'That code is not right. Check it and try again.',
    expired: 'The code has expired. Send a new one.',
    not_found: "We couldn't find an active sign-in request for this number. Send a new code.",
    network: 'No internet connection. Check your connection and try again.',
    generic: 'Something went wrong on our side. Please try again in a moment.',
  },
  fr: {
    already_registered: 'Ce numéro est déjà inscrit. Vous pouvez simplement vous connecter.',
    not_registered: "Ce numéro n'est pas encore inscrit.",
    invalid_phone: "Ce numéro de téléphone n'est pas valide. Essayez le format 050-000-0000.",
    invalid_email: "Cette adresse e-mail n'est pas valide.",
    missing_name: 'Veuillez indiquer votre nom complet.',
    rate_limited: 'Trop de tentatives. Réessayez dans quelques minutes.',
    email_not_configured: "L'envoi des codes par e-mail n'est pas encore configuré. Vous pouvez vous connecter avec le compte de démonstration.",
    invalid_code: "Ce code n'est pas le bon. Vérifiez-le et réessayez.",
    expired: 'Le code a expiré. Demandez-en un nouveau.',
    not_found: "Aucune demande de connexion active pour ce numéro. Demandez un nouveau code.",
    network: 'Pas de connexion Internet. Vérifiez votre connexion et réessayez.',
    generic: 'Un problème est survenu de notre côté. Réessayez dans un instant.',
  },
});

/** The demo account (app_settings.demo_phone) — offered when email codes are not configured. */
export const DEMO_PHONE = '0500000000';
