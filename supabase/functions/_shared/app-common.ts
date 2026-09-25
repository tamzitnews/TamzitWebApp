// Shared helpers for the Tamzit app edge functions (app-*).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : undefined;
}

export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function anonClient(): SupabaseClient {
  const key = env('SUPABASE_ANON_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(env('SUPABASE_URL')!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Phone normalisation to E.164 (same rules as public.app_normalize_phone):
 * 05X-XXXXXXX, 5XXXXXXXX, 9725XXXXXXXX, +9725XXXXXXXX, 00972…, +972-05X… → +9725XXXXXXXX.
 * Other international numbers with + or 00 are kept as +<digits> (7–15 digits). Otherwise null.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const raw = String(input).trim();
  let plus = raw.startsWith('+');
  let d = raw.replace(/\D/g, '');
  if (!plus && d.startsWith('00')) {
    plus = true;
    d = d.slice(2);
  }
  if (plus || d.startsWith('972')) {
    if (d.startsWith('972')) {
      let rest = d.slice(3);
      if (rest.startsWith('0')) rest = rest.slice(1);
      return /^5\d{8}$/.test(rest) ? `+972${rest}` : null;
    }
    return plus && /^[1-9]\d{6,14}$/.test(d) ? `+${d}` : null;
  }
  if (/^05\d{8}$/.test(d)) return `+972${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `+972${d}`;
  return null;
}

export function isEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(v);
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash stored in app_login_codes.code_hash. */
export function codeHash(phone: string, code: string): Promise<string> {
  return sha256Hex(`app-login:${phone}:${code}`);
}

export function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, '0');
}

export type Settings = Record<string, unknown>;

export async function getSettings(db: SupabaseClient, keys: string[]): Promise<Settings> {
  const { data, error } = await db.from('app_settings').select('key,value').in('key', keys);
  if (error) throw error;
  const out: Settings = {};
  for (const r of data ?? []) out[r.key as string] = r.value;
  return out;
}

export const DEMO_KEYS = ['demo_phone', 'demo_code', 'demo_email', 'demo_premium_phone', 'demo_premium_email'];

/** Demo account for this phone (store review / testing), or null. */
export function demoAccount(s: Settings, phone: string): { email: string; code: string; premium: boolean } | null {
  const code = s.demo_code ? String(s.demo_code) : '';
  if (!code) return null;
  if (s.demo_phone && normalizePhone(String(s.demo_phone)) === phone && s.demo_email) {
    return { email: String(s.demo_email).toLowerCase(), code, premium: false };
  }
  if (s.demo_premium_phone && normalizePhone(String(s.demo_premium_phone)) === phone && s.demo_premium_email) {
    return { email: String(s.demo_premium_email).toLowerCase(), code, premium: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rate limiting (app_login_attempts)
// ---------------------------------------------------------------------------

export async function countAttempts(db: SupabaseClient, phone: string, kind: 'start' | 'verify'): Promise<number> {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from('app_login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('kind', kind)
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

export async function recordAttempt(
  db: SupabaseClient,
  phone: string,
  kind: 'start' | 'verify',
  success: boolean,
): Promise<number | null> {
  const { data, error } = await db.from('app_login_attempts').insert({ phone, kind, success }).select('id').single();
  if (error) {
    console.error('recordAttempt', error.message);
    return null;
  }
  return data.id as number;
}

export async function markAttemptSuccess(db: SupabaseClient, id: number | null) {
  if (id == null) return;
  await db.from('app_login_attempts').update({ success: true }).eq('id', id);
}

// ---------------------------------------------------------------------------
// Email delivery (Brevo or Resend; never the shared Supabase Auth mailer)
// ---------------------------------------------------------------------------

export function emailProvider(): 'brevo' | 'resend' | null {
  if (env('BREVO_API_KEY')) return 'brevo';
  if (env('RESEND_API_KEY')) return 'resend';
  return null;
}

function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '') || 'תמצית החדשות', email: m[2].trim() };
  return { name: 'תמצית החדשות', email: from.trim() };
}

function codeEmailHtml(code: string): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>קוד כניסה</title></head>
<body style="margin:0;padding:0;background:#f4f5f8;font-family:Rubik,Arial,Helvetica,sans-serif;color:#182551;direction:rtl;text-align:right;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#182551;padding:22px 28px;color:#ffffff;font-size:20px;font-weight:700;">תמצית החדשות</td></tr>
        <tr><td style="padding:28px 28px 8px 28px;font-size:17px;line-height:1.6;">
          שלום,<br>זה קוד הכניסה שלכם לאפליקציה:
        </td></tr>
        <tr><td align="center" style="padding:12px 28px 4px 28px;">
          <div dir="ltr" style="display:inline-block;background:#eef0f6;border-radius:12px;padding:16px 28px;font-size:40px;font-weight:700;letter-spacing:10px;color:#182551;font-family:'Courier New',monospace;">${code}</div>
        </td></tr>
        <tr><td style="padding:12px 28px 4px 28px;font-size:16px;line-height:1.6;">הקוד בתוקף ל־10 דקות.</td></tr>
        <tr><td style="padding:4px 28px 28px 28px;font-size:14px;line-height:1.6;color:#5b6378;">
          אם לא ביקשתם להתחבר, אפשר להתעלם מההודעה הזו. אף אחד לא יוכל להיכנס בלי הקוד.
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e6e8ef;font-size:12px;color:#8a90a2;">תמצית החדשות · צורכים חדשות אחרת</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Sends the 6-digit code. Throws on provider errors. */
export async function sendCodeEmail(to: string, code: string): Promise<void> {
  const provider = emailProvider();
  if (!provider) throw new Error('email_not_configured');
  const from = parseFrom(env('EMAIL_FROM') ?? 'תמצית החדשות <no-reply@tamzit.org.il>');
  const subject = `קוד הכניסה לתמצית החדשות: ${code}`;
  const text = `קוד הכניסה שלכם לתמצית החדשות: ${code}\nהקוד בתוקף ל־10 דקות.\nאם לא ביקשתם להתחבר, אפשר להתעלם מההודעה.`;
  const html = codeEmailHtml(code);
  let res: Response;
  if (provider === 'brevo') {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env('BREVO_API_KEY')!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
    });
  } else {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')!}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, html, text }),
    });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${provider} ${res.status}: ${detail.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Session minting through Supabase Auth (admin generateLink + verifyOtp)
// ---------------------------------------------------------------------------

export type MintedSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
};

/** Makes sure an auth user exists for the email (creates it confirmed if missing). */
export async function ensureAuthUser(db: SupabaseClient, email: string): Promise<void> {
  const { error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { tamzit_app: true },
  });
  if (error) {
    const code = (error as { code?: string }).code ?? '';
    const msg = error.message ?? '';
    if (code === 'email_exists' || /already been registered|already registered|exists/i.test(msg)) return;
    throw error;
  }
}

/** Issues a real Supabase session for the email without sending any email. */
export async function mintSession(db: SupabaseClient, email: string): Promise<MintedSession> {
  await ensureAuthUser(db, email);
  const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError || !link?.properties) throw linkError ?? new Error('generateLink failed');
  const anon = anonClient();
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  let session = data?.session;
  if (error || !session) {
    // fallback: the raw OTP with type 'email'
    const r = await anon.auth.verifyOtp({ email, token: link.properties.email_otp, type: 'email' });
    if (r.error || !r.data.session) throw r.error ?? error ?? new Error('verifyOtp failed');
    session = r.data.session;
  }
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    user_id: session.user.id,
  };
}
