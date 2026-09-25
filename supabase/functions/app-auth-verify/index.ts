// POST /functions/v1/app-auth-verify
// { phone, code }
// → 200 { access_token, refresh_token, expires_in, user_id, is_new }  |  4xx { error }
// Checks the 6-digit code issued by app-auth-start (or the demo code for the demo phones), then mints a
// real Supabase session for the account email (admin generateLink + verifyOtp; no email is sent).
// Creates the user_preferences row (the profile) on the first verify of a registration.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  adminClient,
  codeHash,
  corsHeaders,
  countAttempts,
  DEMO_KEYS,
  demoAccount,
  getSettings,
  json,
  markAttemptSuccess,
  mintSession,
  normalizePhone,
  readBody,
  recordAttempt,
} from '../_shared/app-common.ts';

const MAX_VERIFIES = 10; // per phone per 15 minutes
const MAX_CODE_ATTEMPTS = 5; // wrong guesses per issued code

async function cityIdFor(db: SupabaseClient, city: string | null): Promise<string | null> {
  if (!city) return null;
  const c = city.trim().toLowerCase();
  const { data } = await db.from('app_cities').select('id,name_he,name_en,name_fr').eq('active', true);
  const hit = (data ?? []).find((r) =>
    [r.id, r.name_he, r.name_en, r.name_fr].some((v) => typeof v === 'string' && v.toLowerCase() === c)
  );
  return hit ? (hit.id as string) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await readBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json({ error: 'invalid_phone' }, 400);
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!code) return json({ error: 'invalid_code' }, 400);

    const db = adminClient();
    const settings = await getSettings(db, DEMO_KEYS);
    const demo = demoAccount(settings, phone);

    // Demo phones are shared by testers and store review: no rate limit for them.
    let attemptId: number | null = null;
    if (!demo) {
      if ((await countAttempts(db, phone, 'verify')) >= MAX_VERIFIES) return json({ error: 'rate_limited' }, 429);
      attemptId = await recordAttempt(db, phone, 'verify', false);
    }

    let email: string;
    let mode: 'register' | 'login' | 'demo';
    if (demo) {
      if (code !== demo.code) return json({ error: 'invalid_code' }, 400);
      email = demo.email;
      mode = 'demo';
    } else {
      const { data: row, error } = await db.from('app_login_codes').select('*').eq('phone', phone).maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: 'not_found' }, 404);
      if (new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_CODE_ATTEMPTS) {
        await db.from('app_login_codes').delete().eq('phone', phone);
        return json({ error: 'expired' }, 410);
      }
      if ((await codeHash(phone, code)) !== row.code_hash) {
        await db.from('app_login_codes').update({ attempts: row.attempts + 1 }).eq('phone', phone);
        return json({ error: 'invalid_code' }, 400);
      }
      email = String(row.email);
      mode = row.mode;
    }

    // Registration data (needed before minting so an expired registration does not create a user).
    let pending: Record<string, unknown> | null = null;
    const { data: existing, error: exError } = await db
      .from('user_preferences')
      .select('user_id')
      .eq('phone', phone)
      .maybeSingle();
    if (exError) throw exError;
    if (!existing && mode !== 'demo') {
      const { data: p, error: pErr } = await db
        .from('app_pending_registrations')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!p) return json({ error: 'not_found' }, 404);
      if (new Date(p.expires_at as string).getTime() < Date.now()) return json({ error: 'expired' }, 410);
      pending = p;
    }

    const session = await mintSession(db, email);

    let isNew = false;
    if (existing) {
      if (existing.user_id !== session.user_id) {
        console.error('app-auth-verify: profile id does not match the auth user for', phone);
        return json({ error: 'server_error' }, 500);
      }
    } else {
      const cityId = pending ? await cityIdFor(db, (pending.city as string) ?? null) : null;
      // user_preferences is the existing profile table: contract fields map to name / persona (style) /
      // anxiety_level (level_filter) / update_frequency (frequency) / interests (topics).
      const row: Record<string, unknown> = {
        user_id: session.user_id,
        name: pending
          ? pending.full_name
          : demo?.plan === 'premium' ? 'הדגמה פרימיום' : demo?.plan === 'family' ? 'הדגמה משפחתי' : 'משתמש הדגמה',
        phone,
        email,
        birth_year: pending ? pending.birth_year ?? null : null,
        city: pending ? pending.city ?? null : null,
        persona: 'Calming',
        anxiety_level: 'Medium',
        update_frequency: 3,
        slot_times: ['07:30', '13:00', '20:00'],
        interests: [],
        communities: pending ? [] : ['jerusalem'],
        language: 'he',
        audience: 'general',
        special_push: true,
        edition_push: true,
        headline_in_push: false,
        text_scale: 1,
        theme: 'system',
        shabbat_city_id: cityId ?? 'jerusalem',
        onboarded: !pending,
        updated_at: new Date().toISOString(),
      };
      const { error: insError } = await db.from('user_preferences').insert(row);
      if (insError && insError.code !== '23505') throw insError;
      isNew = !insError;
      await db.from('app_pending_registrations').delete().eq('phone', phone);
    }

    // An invited family member joins when they sign in.
    await db
      .from('app_family_members')
      .update({ status: 'joined', joined_at: new Date().toISOString() })
      .eq('member_phone', phone)
      .eq('status', 'invited');

    if (mode !== 'demo') await db.from('app_login_codes').delete().eq('phone', phone);
    await markAttemptSuccess(db, attemptId);

    return json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user_id: session.user_id,
      is_new: isNew,
    });
  } catch (e) {
    console.error('app-auth-verify', e);
    return json({ error: 'server_error' }, 500);
  }
});
