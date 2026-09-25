// POST /functions/v1/app-push-special   { edition_id }
// Called by the trigger app_tamzit_editions_push (pg_net) once per distinct special update inserted into
// tamzit_editions (edition_type 'special_update'); header x-app-secret must equal app_settings.push_webhook_secret.
// Sends one push per device whose user_preferences row has special_push = true and the edition's language,
// except readers whose Shabbat city is inside a rest period (app_rest_periods) right now.
//  - native FCM tokens → FCM HTTP v1 (needs the FCM_SERVICE_ACCOUNT secret: the service-account JSON)
//  - Expo tokens (ExponentPushToken[…]) → Expo push API
// Without anything to send through (e.g. no FCM_SERVICE_ACCOUNT and only native tokens) → 200 { skipped: true }.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, env, json, readBody } from '../_shared/app-common.ts';

type Target = { token: string; headline_in_push: boolean; shabbat_city_id: string };

const TITLES: Record<string, string> = { he: 'עדכון מיוחד', en: 'Special update', fr: 'Mise à jour spéciale' };
const GENERIC: Record<string, string> = {
  he: 'יש עדכון חשוב באפליקציה.',
  en: 'There is an important update in the app.',
  fr: 'Une mise à jour importante vous attend dans l’application.',
};

// --- FCM HTTP v1 ------------------------------------------------------------

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)),
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function sendFcm(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<'ok' | 'invalid' | 'error'> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        android: { priority: 'high', notification: { channel_id: 'special' } },
        apns: { payload: { aps: { sound: 'default' } } },
      },
    }),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return 'invalid';
  if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return 'invalid';
  console.error('fcm', res.status, text.slice(0, 300));
  return 'error';
}

// --- Expo push ----------------------------------------------------------------

async function sendExpo(
  messages: { to: string; title: string; body: string; data: Record<string, string> }[],
): Promise<{ sent: number; invalid: string[] }> {
  let sent = 0;
  const invalid: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ ...m, sound: 'default', priority: 'high', channelId: 'special' }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error('expo', res.status, (await res.text()).slice(0, 300));
      continue;
    }
    const out = await res.json();
    (out.data ?? []).forEach((t: { status: string; details?: { error?: string } }, j: number) => {
      if (t.status === 'ok') sent++;
      else if (t.details?.error === 'DeviceNotRegistered') invalid.push(chunk[j].to);
    });
  }
  return { sent, invalid };
}

// --------------------------------------------------------------------------------

async function loadTargets(db: SupabaseClient, language: string): Promise<Target[]> {
  const { data, error } = await db
    .from('app_devices')
    .select('push_token, user_preferences!inner(headline_in_push, shabbat_city_id, special_push, language)')
    .eq('user_preferences.special_push', true)
    .eq('user_preferences.language', language);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const p = r.user_preferences as Record<string, unknown>;
    return {
      token: r.push_token as string,
      headline_in_push: !!p.headline_in_push,
      shabbat_city_id: (p.shabbat_city_id as string) ?? 'jerusalem',
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const db = adminClient();
    const { data: secretRow } = await db.from('app_settings').select('value').eq('key', 'push_webhook_secret').maybeSingle();
    const expected = secretRow?.value ? String(secretRow.value) : '';
    if (!expected || req.headers.get('x-app-secret') !== expected) return json({ error: 'forbidden' }, 403);

    const body = await readBody(req);
    const editionId = Number(body.edition_id);
    if (!Number.isSafeInteger(editionId)) return json({ error: 'missing_edition_id' }, 400);

    const { data: payload, error: pErr } = await db.rpc('app_push_payload', { p_edition_id: editionId });
    if (pErr) throw pErr;
    if (!payload) return json({ error: 'not_found' }, 404);
    if (payload.edition_type !== 'special_update') return json({ skipped: true, reason: 'not_a_special_update' });
    if (Date.now() - new Date(payload.created_at as string).getTime() > 6 * 3600 * 1000) {
      return json({ skipped: true, reason: 'too_old' });
    }

    const { data: log } = await db.from('app_push_log').select('key, pushed_at').eq('edition_id', editionId).maybeSingle();
    if (log?.pushed_at) return json({ skipped: true, reason: 'already_pushed' });

    const language = (payload.language as string) ?? 'he';
    const targets = await loadTargets(db, language);
    const saRaw = env('FCM_SERVICE_ACCOUNT');
    const isExpo = (t: Target) => t.token.startsWith('ExponentPushToken[') || t.token.startsWith('ExpoPushToken[');
    const expoTargets = targets.filter(isExpo);
    const fcmTargets = targets.filter((t) => !isExpo(t));
    if (!saRaw && fcmTargets.length) console.log(`app-push-special: FCM_SERVICE_ACCOUNT missing; ${fcmTargets.length} native tokens skipped`);
    if (!expoTargets.length && (!saRaw || !fcmTargets.length)) {
      const result = { skipped: true, reason: saRaw ? 'no_devices' : 'fcm_not_configured', devices: targets.length };
      if (log) await db.from('app_push_log').update({ result }).eq('key', log.key);
      return json(result);
    }

    // Shabbat / Yom Tov: no pushes for readers whose city is resting now.
    const nowIso = new Date().toISOString();
    const cityIds = [...new Set(targets.map((t) => t.shabbat_city_id))];
    const { data: resting } = await db
      .from('app_rest_periods')
      .select('city_id')
      .in('city_id', cityIds)
      .lte('starts_at', nowIso)
      .gt('ends_at', nowIso);
    const restingCities = new Set((resting ?? []).map((r: { city_id: string }) => r.city_id));

    const title = TITLES[language] ?? TITLES.he;
    const data = { type: 'special', edition_id: String(editionId), url: `tamzit://edition/${editionId}` };
    const headline = typeof payload.headline === 'string' && payload.headline ? payload.headline : null;
    const message = (t: Target) => (t.headline_in_push && headline ? headline : GENERIC[language] ?? GENERIC.he);

    let sent = 0;
    let shabbat = 0;
    const invalid: string[] = [];
    const awake = (t: Target) => {
      if (restingCities.has(t.shabbat_city_id)) {
        shabbat++;
        return false;
      }
      return true;
    };

    const expoMsgs = expoTargets.filter(awake).map((t) => ({ to: t.token, title, body: message(t), data }));
    if (expoMsgs.length) {
      const r = await sendExpo(expoMsgs);
      sent += r.sent;
      invalid.push(...r.invalid);
    }
    if (saRaw && fcmTargets.length) {
      const sa = JSON.parse(saRaw);
      const accessToken = await fcmAccessToken(sa);
      for (const t of fcmTargets.filter(awake)) {
        const r = await sendFcm(sa.project_id, accessToken, t.token, title, message(t), data);
        if (r === 'ok') sent++;
        else if (r === 'invalid') invalid.push(t.token);
      }
    }

    if (invalid.length) await db.from('app_devices').delete().in('push_token', invalid);
    const result = { ok: true, sent, skipped_shabbat: shabbat, removed_tokens: invalid.length };
    if (log) await db.from('app_push_log').update({ pushed_at: new Date().toISOString(), result }).eq('key', log.key);
    console.log('app-push-special', { edition: editionId, ...result });
    return json(result);
  } catch (e) {
    console.error('app-push-special', e);
    return json({ error: 'server_error' }, 500);
  }
});
