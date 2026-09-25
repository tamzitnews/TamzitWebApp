// POST /functions/v1/app-auth-start
// { mode: 'register'|'login', phone, full_name?, email?, birth_year?, city? }
// → 200 { ok: true, masked_email }  |  4xx/5xx { error }
// Sends a 6-digit code (valid 10 minutes) to the account email through Brevo or Resend.
import {
  adminClient,
  codeHash,
  corsHeaders,
  countAttempts,
  DEMO_KEYS,
  demoAccount,
  emailProvider,
  getSettings,
  isEmail,
  json,
  markAttemptSuccess,
  maskEmail,
  normalizePhone,
  randomCode,
  readBody,
  recordAttempt,
  sendCodeEmail,
} from '../_shared/app-common.ts';

const MAX_STARTS = 5; // per phone per 15 minutes

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await readBody(req);
    const mode = body.mode === 'register' || body.mode === 'login' ? body.mode : null;
    if (!mode) return json({ error: 'invalid_mode' }, 400);
    const phone = normalizePhone(body.phone);
    if (!phone) return json({ error: 'invalid_phone' }, 400);

    const db = adminClient();
    if ((await countAttempts(db, phone, 'start')) >= MAX_STARTS) return json({ error: 'rate_limited' }, 429);
    const attemptId = await recordAttempt(db, phone, 'start', false);

    // Demo accounts: no email, the fixed demo code works in app-auth-verify.
    const settings = await getSettings(db, DEMO_KEYS);
    const demo = demoAccount(settings, phone);
    if (demo) {
      await markAttemptSuccess(db, attemptId);
      return json({ ok: true, masked_email: maskEmail(demo.email) });
    }

    const { data: profile, error: profileError } = await db
      .from('app_profiles')
      .select('id,email')
      .eq('phone', phone)
      .maybeSingle();
    if (profileError) throw profileError;

    let email: string;
    if (mode === 'register') {
      if (profile) return json({ error: 'already_registered' }, 409);
      const fullName = typeof body.full_name === 'string' ? body.full_name.trim().replace(/\s+/g, ' ') : '';
      if (fullName.length < 2 || fullName.length > 80) return json({ error: 'missing_name' }, 400);
      email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(email)) return json({ error: 'invalid_email' }, 400);

      const { data: sameEmail, error: emailError } = await db
        .from('app_profiles')
        .select('id')
        .eq('email', email)
        .limit(1);
      if (emailError) throw emailError;
      if (sameEmail && sameEmail.length > 0) return json({ error: 'email_in_use' }, 409);

      const by = Number(body.birth_year);
      const birthYear = Number.isInteger(by) && by >= 1900 && by <= new Date().getFullYear() ? by : null;
      const city = typeof body.city === 'string' && body.city.trim() ? body.city.trim().slice(0, 80) : null;
      const now = Date.now();
      const { error: pendError } = await db.from('app_pending_registrations').upsert({
        phone,
        full_name: fullName,
        email,
        birth_year: birthYear,
        city,
        created_at: new Date(now).toISOString(),
        expires_at: new Date(now + 30 * 60 * 1000).toISOString(),
      });
      if (pendError) throw pendError;
    } else {
      if (!profile) return json({ error: 'not_registered' }, 404);
      email = String(profile.email).toLowerCase();
    }

    if (!emailProvider()) {
      console.warn('app-auth-start: no BREVO_API_KEY / RESEND_API_KEY secret; cannot send codes');
      return json({ error: 'email_not_configured' }, 503);
    }

    const code = randomCode();
    const now = Date.now();
    const { error: codeError } = await db.from('app_login_codes').upsert({
      phone,
      email,
      mode,
      code_hash: await codeHash(phone, code),
      attempts: 0,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 10 * 60 * 1000).toISOString(),
    });
    if (codeError) throw codeError;

    try {
      await sendCodeEmail(email, code);
    } catch (e) {
      console.error('app-auth-start: email delivery failed', String(e));
      await db.from('app_login_codes').delete().eq('phone', phone);
      return json({ error: 'email_failed' }, 502);
    }

    await markAttemptSuccess(db, attemptId);
    return json({ ok: true, masked_email: maskEmail(email) });
  } catch (e) {
    console.error('app-auth-start', e);
    return json({ error: 'server_error' }, 500);
  }
});
