// POST /functions/v1/app-push-special   { edition_id }
// Called by the database trigger app_editions_push_special (pg_net) when a 'special' edition is published.
// Header x-app-secret must equal app_settings.push_webhook_secret.
// Sends one push per device whose profile has special_push = true and the edition's language + audience,
// except readers whose Shabbat city is currently in Shabbat or Yom Tov.
//  - native FCM tokens → FCM HTTP v1 (needs the FCM_SERVICE_ACCOUNT secret: the service-account JSON)
//  - Expo tokens (ExponentPushToken[…]) → Expo push API
// Without anything to send through (e.g. no FCM_SERVICE_ACCOUNT and only native tokens) → 200 { skipped: true }.
import { HebrewCalendar, Location } from 'npm:@hebcal/core@5';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, env, json, readBody } from '../_shared/app-common.ts';

type City = { id: string; lat: number; lon: number; tzid: string; in_israel: boolean; candle_minutes: number };
type Target = {
  token: string;
  platform: string;
  style: string;
  headline_in_push: boolean;
  shabbat_city_id: string;
};

const TITLES: Record<string, string> = { he: 'עדכון מיוחד', en: 'Special update', fr: 'Mise à jour spéciale' };
const GENERIC: Record<string, string> = {
  he: 'יש עדכון חשוב באפליקציה.',
  en: 'There is an important update in the app.',
  fr: 'Une mise à jour importante vous attend dans l’application.',
};

/** True between candle lighting and havdalah (Shabbat and Yom Tov) for the city. */
function inShabbat(city: City | undefined, now: Date): boolean {
  if (!city) return false;
  try {
    const loc = new Location(city.lat, city.lon, city.in_israel, city.tzid, city.id, city.in_israel ? 'IL' : undefined);
    const events = HebrewCalendar.calendar({
      start: new Date(now.getTime() - 3 * 86400000),
      end: new Date(now.getTime() + 86400000),
      location: loc,
      candlelighting: true,
      il: city.in_israel,
      candleLightingMins: city.candle_minutes,
    });
    let last: string | null = null;
    let lastTime = 0;
    for (const e of events) {
      const desc = e.getDesc();
      const name = desc === 'Candle lighting' ? 'CandleLightingEvent' : desc === 'Havdalah' ? 'HavdalahEvent' : null;
      const t = (e as unknown as { eventTime?: Date }).eventTime;
      if (!t || !name) continue;
      if (t.getTime() <= now.getTime() && t.getTime() >= lastTime) {
        last = name;
        lastTime = t.getTime();
      }
    }
    return last === 'CandleLightingEvent';
  } catch (e) {
    console.error('inShabbat', e);
    return false;
  }
}

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
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
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
    const chunk = messages.slice(i, i + 100).map((m) => ({
      ...m,
      sound: 'default',
      priority: 'high',
      channelId: 'special',
    }));
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

async function loadTargets(db: SupabaseClient, language: string, audience: string): Promise<Target[]> {
  const { data, error } = await db
    .from('app_devices')
    .select('push_token, platform, app_profiles!inner(style, headline_in_push, shabbat_city_id, special_push, language, audience)')
    .eq('app_profiles.special_push', true)
    .eq('app_profiles.language', language)
    .eq('app_profiles.audience', audience);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const p = r.app_profiles as Record<string, unknown>;
    return {
      token: r.push_token as string,
      platform: r.platform as string,
      style: p.style as string,
      headline_in_push: !!p.headline_in_push,
      shabbat_city_id: p.shabbat_city_id as string,
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
    const editionId = typeof body.edition_id === 'string' ? body.edition_id : '';
    if (!editionId) return json({ error: 'missing_edition_id' }, 400);

    const { data: edition, error: edError } = await db.from('app_editions').select('*').eq('id', editionId).maybeSingle();
    if (edError) throw edError;
    if (!edition) return json({ error: 'not_found' }, 404);
    if (edition.edition_type !== 'special' || edition.status !== 'published') return json({ skipped: true, reason: 'not_a_published_special' });
    if (edition.pushed_at) return json({ skipped: true, reason: 'already_pushed' });

    const targets = await loadTargets(db, edition.language, edition.audience);
    const saRaw = env('FCM_SERVICE_ACCOUNT');
    const expoTargets = targets.filter((t) => t.token.startsWith('ExponentPushToken[') || t.token.startsWith('ExpoPushToken['));
    const fcmTargets = targets.filter((t) => !expoTargets.includes(t));
    if (!saRaw && fcmTargets.length) console.log(`app-push-special: FCM_SERVICE_ACCOUNT missing; ${fcmTargets.length} native tokens skipped`);
    if (!expoTargets.length && (!saRaw || !fcmTargets.length)) {
      console.log('app-push-special: nothing to send', { edition: editionId, targets: targets.length, fcm: !!saRaw });
      return json({ skipped: true, reason: saRaw ? 'no_devices' : 'fcm_not_configured', devices: targets.length });
    }

    // headline of the first item, per style
    const { data: firstItem } = await db
      .from('app_edition_items')
      .select('item_id, position')
      .eq('edition_id', editionId)
      .order('position')
      .limit(1)
      .maybeSingle();
    const headlines: Record<string, string> = {};
    if (firstItem) {
      const { data: versions } = await db
        .from('app_item_versions')
        .select('style, headline')
        .eq('item_id', firstItem.item_id)
        .eq('language', edition.language)
        .eq('audience', edition.audience);
      for (const v of versions ?? []) headlines[v.style as string] = v.headline as string;
    }
    const headlineFor = (style: string) =>
      headlines[style] ?? headlines.informative ?? Object.values(headlines)[0] ?? edition.title ?? null;

    const cityIds = [...new Set(targets.map((t) => t.shabbat_city_id))];
    const { data: cities } = await db.from('app_cities').select('id,lat,lon,tzid,in_israel,candle_minutes').in('id', cityIds);
    const now = new Date();
    const resting = new Map<string, boolean>();
    for (const c of (cities ?? []) as City[]) resting.set(c.id, inShabbat(c, now));

    const title = TITLES[edition.language] ?? TITLES.he;
    const data = { type: 'special', edition_id: editionId, url: `tamzit://edition/${editionId}` };
    const message = (t: Target) => (t.headline_in_push ? headlineFor(t.style) : null) ?? GENERIC[edition.language] ?? GENERIC.he;

    let sent = 0;
    let shabbat = 0;
    const invalid: string[] = [];

    const expoMsgs = expoTargets
      .filter((t) => (resting.get(t.shabbat_city_id) ? (shabbat++, false) : true))
      .map((t) => ({ to: t.token, title, body: message(t), data }));
    if (expoMsgs.length) {
      const r = await sendExpo(expoMsgs);
      sent += r.sent;
      invalid.push(...r.invalid);
    }

    if (saRaw && fcmTargets.length) {
      const sa = JSON.parse(saRaw);
      const accessToken = await fcmAccessToken(sa);
      for (const t of fcmTargets) {
        if (resting.get(t.shabbat_city_id)) {
          shabbat++;
          continue;
        }
        const r = await sendFcm(sa.project_id, accessToken, t.token, title, message(t), data);
        if (r === 'ok') sent++;
        else if (r === 'invalid') invalid.push(t.token);
      }
    }

    if (invalid.length) await db.from('app_devices').delete().in('push_token', invalid);
    await db.from('app_editions').update({ pushed_at: new Date().toISOString() }).eq('id', editionId);
    console.log('app-push-special', { edition: editionId, sent, shabbat, invalid: invalid.length });
    return json({ ok: true, sent, skipped_shabbat: shabbat, removed_tokens: invalid.length });
  } catch (e) {
    console.error('app-push-special', e);
    return json({ error: 'server_error' }, 500);
  }
});
