// POST /functions/v1/app-push
//   { edition_id }                               the engine's push for one edition (needs push_webhook_secret)
//   { action: 'audience' | 'broadcast' | 'history' }   the operator's console: signed in as a person whose account is
//        listed in app_settings.console_admin_emails (Authorization: Bearer <their token>), or with push_console_secret
// Called by the trigger app_tamzit_editions_push (pg_net) once per published edition: one call per distinct special
// update, and one per regular edition (language, track, slot, day; the engine inserts each edition several times).
// Header x-app-secret must equal app_settings.push_webhook_secret.
//  - special update → every device whose reader has special_push on and the edition's language (channel "special");
//  - regular edition → every device whose reader has edition_push on and gets this edition
//    (public.app_push_edition_targets: track and frequency rules), channel "editions".
// Readers whose Shabbat city is inside a rest period (app_rest_periods) right now are skipped.
//  - native FCM tokens → FCM HTTP v1 (needs the FCM_SERVICE_ACCOUNT secret: the service-account JSON)
//  - Expo tokens (ExponentPushToken[…]) → Expo push API
// Without anything to send through (e.g. no FCM_SERVICE_ACCOUNT and only native tokens) → 200 { skipped: true }.
// Texts and the maximum age come from app_settings (push_special_title_<lang>, push_special_body_<lang>,
// push_edition_body_<lang>, push_max_age_minutes); the constants below are the defaults.
//
// The console (a private web page the operator opens) sends one message to every device, or to the devices of one
// language: audience = how many devices there are, broadcast = send it (dry_run first), history = what was sent
// (app_push_broadcasts). It authenticates with app_settings.push_console_secret, which cannot push an edition.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, env, getSettings, json, readBody, settingInt, settingText } from '../_shared/app-common.ts';

type Target = { token: string; headline_in_push: boolean; shabbat_city_id: string };
type Lang = 'he' | 'en' | 'fr';

const SPECIAL_TITLE: Record<Lang, string> = { he: 'עדכון מיוחד', en: 'Special update', fr: 'Mise à jour spéciale' };
const SPECIAL_BODY: Record<Lang, string> = {
  he: 'יש עדכון חשוב באפליקציה.',
  en: 'There is an important update in the app.',
  fr: 'Une mise à jour importante vous attend dans l’application.',
};

// Edition names by kind (app_edition_kind) and track.
const EDITION_NAME: Record<Lang, Record<string, string>> = {
  he: {
    morning: 'מהדורת הבוקר',
    noon: 'מהדורת הצהריים',
    evening: 'מהדורת הערב',
    motzash: 'מהדורת מוצאי שבת',
    erev_shabbat: 'מהדורת ערב שבת',
    daily: 'המהדורה היומית',
  },
  en: {
    morning: 'The morning edition',
    noon: 'The afternoon edition',
    evening: 'The evening edition',
    motzash: 'The Motzei Shabbat edition',
    erev_shabbat: 'The Erev Shabbat edition',
    daily: 'The daily edition',
  },
  fr: {
    morning: 'L’édition du matin',
    noon: 'L’édition de midi',
    evening: 'L’édition du soir',
    motzash: 'L’édition de Motsaé Chabbat',
    erev_shabbat: 'L’édition de veille de Chabbat',
    daily: 'L’édition quotidienne',
  },
};
const READY: Record<Lang, (name: string) => string> = {
  he: (n) => `${n} מוכנה`,
  en: (n) => `${n} is ready`,
  fr: (n) => `${n} est prête`,
};
const EDITION_BODY: Record<Lang, string> = {
  he: 'כמה דקות, ואתם מעודכנים.',
  en: 'A few minutes, and you’re up to date.',
  fr: 'Quelques minutes, et vous êtes à jour.',
};

// --- FCM HTTP v1 ------------------------------------------------------------

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

/** What the secret looks like, without any of its values (top-level key names only): for the operator. */
function saShape(raw: string): Record<string, unknown> {
  const t = raw.trim();
  let keys: string[] | null = null;
  try {
    const v = JSON.parse(t);
    keys = v && typeof v === 'object' ? Object.keys(v).slice(0, 20) : [typeof v];
  } catch {
    // not JSON
  }
  return {
    length: t.length,
    json: keys !== null,
    keys,
    starts_with_brace: t.startsWith('{'),
    has_private_key_block: t.includes('BEGIN PRIVATE KEY'),
    has_client_email: t.includes('client_email'),
    looks_base64: /^[A-Za-z0-9+/=\s]+$/.test(t),
    looks_base64url: /^[A-Za-z0-9_=-]+$/.test(t),
    has_dashes: t.includes('-----'),
    has_word_private: /private/i.test(t),
    key_body: t.replace(/\\n|\s/g, '').startsWith('MII'),
    literal_backslash_n: (t.match(/\\n/g) ?? []).length,
    line_breaks: (t.match(/\n/g) ?? []).length,
  };
}
class ShapeError extends Error {
  constructor(readonly shape: Record<string, unknown>) {
    super('FCM_SERVICE_ACCOUNT is not a service account JSON');
  }
}

/** The FCM_SERVICE_ACCOUNT secret: the service account JSON as is, base64, JSON in a string, or pasted with real line
 * breaks inside the key (not valid JSON; then its three fields are read directly). */
function parseServiceAccount(raw: string): ServiceAccount {
  const texts = [raw.trim()];
  try {
    texts.push(atob(raw.trim()));
  } catch {
    // not base64
  }
  for (const t of texts) {
    try {
      let v = JSON.parse(t);
      if (typeof v === 'string') v = JSON.parse(v);
      if (v?.client_email && v?.private_key && v?.project_id) return v as ServiceAccount;
    } catch {
      // next form
    }
  }
  const text = texts.find((t) => t.includes('client_email')) ?? '';
  const field = (k: string) => text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`))?.[1];
  const key = text.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)?.[0];
  const email = field('client_email');
  const project = field('project_id');
  if (!key || !email || !project) throw new ShapeError(saShape(raw));
  return { client_email: email, private_key: key.replace(/\\n/g, '\n'), project_id: project };
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
  if (!res.ok) throw new Error(`oauth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token as string;
}

async function sendFcm(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
  channelId: string,
): Promise<'ok' | 'invalid' | 'error'> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        android: { priority: 'high', notification: { channel_id: channelId } },
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

const isExpoToken = (token: string) => token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');

async function sendExpo(
  messages: { to: string; title: string; body: string; data: Record<string, string> }[],
  channelId: string,
): Promise<{ sent: number; invalid: string[] }> {
  let sent = 0;
  const invalid: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ ...m, sound: 'default', priority: 'high', channelId }));
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

/** Cities resting right now (Shabbat / Yom Tov), of those asked about. */
async function restingCities(db: SupabaseClient, cityIds: string[]): Promise<Set<string>> {
  if (!cityIds.length) return new Set();
  const nowIso = new Date().toISOString();
  const { data } = await db
    .from('app_rest_periods')
    .select('city_id')
    .in('city_id', cityIds)
    .lte('starts_at', nowIso)
    .gt('ends_at', nowIso);
  return new Set((data ?? []).map((r: { city_id: string }) => r.city_id));
}

/** Sends one message to the given tokens; counts the outcomes per service. */
async function sendToTokens(
  tokens: string[],
  title: string,
  text: string,
  data: Record<string, string>,
  onStage: (s: string) => void,
): Promise<{ sent: number; invalid: string[]; counts: Record<string, number> }> {
  const counts: Record<string, number> = {};
  const invalid: string[] = [];
  let sent = 0;
  const expo = tokens.filter(isExpoToken);
  const native = tokens.filter((t) => !isExpoToken(t));
  if (expo.length) {
    const r = await sendExpo(expo.map((to) => ({ to, title, body: text, data })), 'editions');
    sent += r.sent;
    invalid.push(...r.invalid);
    counts.expo_sent = r.sent;
  }
  const saRaw = env('FCM_SERVICE_ACCOUNT');
  if (native.length && !saRaw) counts.fcm_not_configured = native.length;
  if (native.length && saRaw) {
    onStage('fcm_service_account');
    const sa = parseServiceAccount(saRaw);
    onStage('fcm_oauth');
    const accessToken = await fcmAccessToken(sa);
    onStage('fcm_send');
    for (const t of native) {
      const r = await sendFcm(sa.project_id, accessToken, t, title, text, data, 'editions');
      counts[`fcm_${r}`] = (counts[`fcm_${r}`] ?? 0) + 1;
      if (r === 'ok') sent++;
      else if (r === 'invalid') invalid.push(t);
    }
  }
  return { sent, invalid, counts };
}

type Device = { token: string; language: string | null; platform: string | null; shabbat_city_id: string };

/** Every registered device, with its reader's language and Shabbat city (a device without a profile is kept). */
async function allDevices(db: SupabaseClient): Promise<Device[]> {
  const { data, error } = await db.from('app_devices').select('push_token, platform, user_preferences(language, shabbat_city_id)');
  if (error) throw error;
  const seen = new Set<string>();
  const out: Device[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const token = r.push_token as string;
    if (!token || seen.has(token)) continue;
    seen.add(token);
    const p = (Array.isArray(r.user_preferences) ? r.user_preferences[0] : r.user_preferences) as Record<string, unknown> | null;
    out.push({
      token,
      language: (p?.language as string) ?? null,
      platform: (r.platform as string) ?? null,
      shabbat_city_id: (p?.shabbat_city_id as string) ?? 'jerusalem',
    });
  }
  return out;
}

const tally = (values: (string | null)[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v ?? 'unknown']: (acc[v ?? 'unknown'] ?? 0) + 1 }), {});

async function specialTargets(db: SupabaseClient, language: string): Promise<Target[]> {
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

async function editionTargets(db: SupabaseClient, editionId: number): Promise<Target[]> {
  const { data, error } = await db.rpc('app_push_edition_targets', { p_edition_id: editionId });
  if (error) throw error;
  return ((data ?? []) as { push_token: string; headline_in_push: boolean; shabbat_city_id: string }[]).map((r) => ({
    token: r.push_token,
    headline_in_push: !!r.headline_in_push,
    shabbat_city_id: r.shabbat_city_id ?? 'jerusalem',
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let stage = 'start'; // where a failure happened (returned without details: they may hold secrets)
  let authorized = false;
  let logKey: string | null = null;
  const db = adminClient();
  try {
    const settings = await getSettings(db, [
      'push_webhook_secret', 'push_console_secret', 'push_max_age_minutes',
      ...(['he', 'en', 'fr'] as const).flatMap((l) => [`push_special_title_${l}`, `push_special_body_${l}`, `push_edition_body_${l}`]),
    ]);
    const expected = settingText(settings, 'push_webhook_secret', '');
    const consoleSecret = settingText(settings, 'push_console_secret', '');
    const given = req.headers.get('x-app-secret') ?? '';
    const isAdmin = !!expected && given === expected;
    let isConsole = !!consoleSecret && given === consoleSecret;

    const body = await readBody(req);
    const action = typeof body.action === 'string' ? body.action : '';
    if (action && !['audience', 'broadcast', 'history'].includes(action)) return json({ error: 'unknown_action' }, 400);

    // The console signs in as a person (the app's own login): their account must be listed in console_admin_emails.
    if (!isAdmin && !isConsole && action) {
      stage = 'console_login';
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (jwt) {
        const { data: who } = await db.auth.getUser(jwt);
        if (who?.user) {
          const { data: ok } = await db.rpc('app_is_console_admin', { p_user: who.user.id });
          isConsole = ok === true;
        }
      }
      if (!isConsole) return json({ error: 'not_an_operator' }, 403);
    }
    if (!isAdmin && !isConsole) return json({ error: 'forbidden' }, 403);
    authorized = true;
    if (!action && !isAdmin) return json({ error: 'forbidden' }, 403); // the console cannot push an edition

    // A test message to every registered device, for operators: { action: 'test', body, title? }.
    // --- the operator's console ------------------------------------------------
    if (action === 'audience' || action === 'broadcast') {
      stage = action;
      const devices = await allDevices(db);
      const language = ['he', 'en', 'fr'].includes(String(body.language)) ? String(body.language) : null;
      const chosen = language ? devices.filter((d) => d.language === language) : devices;
      const skipShabbat = body.skip_shabbat !== false;
      const resting = skipShabbat ? await restingCities(db, [...new Set(chosen.map((d) => d.shabbat_city_id))]) : new Set<string>();
      const awake = chosen.filter((d) => !resting.has(d.shabbat_city_id));
      const audience = {
        devices: devices.length,
        matching: chosen.length,
        awake: awake.length,
        skipped_shabbat: chosen.length - awake.length,
        by_language: tally(devices.map((d) => d.language)),
        by_platform: tally(devices.map((d) => d.platform)),
      };
      if (action === 'audience') return json({ ok: true, ...audience });

      const title = String(body.title ?? '').trim().slice(0, 100) || 'תמצית החדשות';
      const text = String(body.body ?? '').trim().slice(0, 500);
      const url = String(body.url ?? '').trim().slice(0, 300);
      if (!text) return json({ error: 'missing_body' }, 400);
      if (url && !/^https?:\/\//.test(url)) return json({ error: 'bad_url' }, 400);
      const message = url ? `${text}\n${url}` : text;
      if (body.dry_run) return json({ ok: true, dry_run: true, message, title, ...audience });

      const { sent, invalid, counts } = await sendToTokens(
        awake.map((d) => d.token),
        title,
        message,
        { type: 'message', url: 'tamzit://' },
        (st) => (stage = st),
      );
      stage = 'log';
      if (invalid.length) await db.from('app_devices').delete().in('push_token', invalid);
      const result = { ...counts, skipped_shabbat: audience.skipped_shabbat, removed_tokens: invalid.length };
      const { data: id } = await db.rpc('app_log_broadcast', {
        p_title: title, p_body: text, p_url: url || null, p_language: language,
        p_devices: awake.length, p_sent: sent, p_result: result,
      });
      console.log('app-push broadcast', { id, devices: awake.length, sent, ...counts });
      return json({ ok: true, id, devices: awake.length, sent, ...result });
    }

    if (action === 'history') {
      stage = 'history';
      const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);
      const { data, error } = await db
        .from('app_push_broadcasts')
        .select('id, created_at, title, body, url, language, devices, sent, result')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return json({ ok: true, broadcasts: data ?? [] });
    }

    const editionId = Number(body.edition_id);
    if (!Number.isSafeInteger(editionId)) return json({ error: 'missing_edition_id' }, 400);

    stage = 'payload';
    const { data: payload, error: pErr } = await db.rpc('app_push_payload', { p_edition_id: editionId });
    if (pErr) throw pErr;
    if (!payload) return json({ error: 'not_found' }, 404);
    const maxAgeMin = settingInt(settings, 'push_max_age_minutes', 120, 10, 1440);
    if (Date.now() - new Date(payload.created_at as string).getTime() > maxAgeMin * 60_000) {
      return json({ skipped: true, reason: 'too_old' });
    }

    const { data: log } = await db.from('app_push_log').select('key, pushed_at').eq('edition_id', editionId).maybeSingle();
    if (log?.pushed_at) return json({ skipped: true, reason: 'already_pushed' });
    logKey = log?.key ?? null;

    const language = (['he', 'en', 'fr'].includes(payload.language) ? payload.language : 'he') as Lang;
    const special = payload.edition_type === 'special_update';
    stage = 'targets';
    const targets = special ? await specialTargets(db, language) : await editionTargets(db, editionId);
    const channelId = special ? 'special' : 'editions';
    const saRaw = env('FCM_SERVICE_ACCOUNT');
    const isExpo = (t: Target) => isExpoToken(t.token);
    const expoTargets = targets.filter(isExpo);
    const fcmTargets = targets.filter((t) => !isExpo(t));
    if (!saRaw && fcmTargets.length) console.log(`app-push: FCM_SERVICE_ACCOUNT missing; ${fcmTargets.length} native tokens skipped`);
    if (!expoTargets.length && (!saRaw || !fcmTargets.length)) {
      const result = { skipped: true, reason: targets.length ? 'fcm_not_configured' : 'no_devices', devices: targets.length };
      if (log) await db.from('app_push_log').update({ result }).eq('key', log.key);
      return json(result);
    }

    // Shabbat / Yom Tov: no pushes for readers whose city is resting now.
    stage = 'rest_periods';
    const resting = await restingCities(db, [...new Set(targets.map((t) => t.shabbat_city_id))]);

    const kind = payload.track === 'daily' ? 'daily' : String(payload.kind ?? 'evening');
    const title = special
      ? settingText(settings, `push_special_title_${language}`, SPECIAL_TITLE[language])
      : READY[language](EDITION_NAME[language][kind] ?? EDITION_NAME[language].evening);
    const data: Record<string, string> = special
      ? { type: 'special', edition_id: String(editionId), url: `tamzit://edition/${editionId}` }
      : { type: 'edition', url: 'tamzit://' };
    const headline = typeof payload.headline === 'string' && payload.headline ? payload.headline : null;
    const fallback = special
      ? settingText(settings, `push_special_body_${language}`, SPECIAL_BODY[language])
      : settingText(settings, `push_edition_body_${language}`, EDITION_BODY[language]);
    const message = (t: Target) => (t.headline_in_push && headline ? headline : fallback);

    let sent = 0;
    let shabbat = 0;
    const invalid: string[] = [];
    const awake = (t: Target) => {
      if (resting.has(t.shabbat_city_id)) {
        shabbat++;
        return false;
      }
      return true;
    };

    const expoMsgs = expoTargets.filter(awake).map((t) => ({ to: t.token, title, body: message(t), data }));
    if (expoMsgs.length) {
      const r = await sendExpo(expoMsgs, channelId);
      sent += r.sent;
      invalid.push(...r.invalid);
    }
    if (saRaw && fcmTargets.length) {
      stage = 'fcm_service_account';
      const sa = parseServiceAccount(saRaw);
      stage = 'fcm_oauth';
      const accessToken = await fcmAccessToken(sa);
      stage = 'fcm_send';
      for (const t of fcmTargets.filter(awake)) {
        const r = await sendFcm(sa.project_id, accessToken, t.token, title, message(t), data, channelId);
        if (r === 'ok') sent++;
        else if (r === 'invalid') invalid.push(t.token);
      }
    }

    stage = 'log';
    if (invalid.length) await db.from('app_devices').delete().in('push_token', invalid);
    const result = { ok: true, kind: special ? 'special' : kind, sent, skipped_shabbat: shabbat, removed_tokens: invalid.length };
    if (log) await db.from('app_push_log').update({ pushed_at: new Date().toISOString(), result }).eq('key', log.key);
    console.log('app-push', { edition: editionId, ...result });
    return json(result);
  } catch (e) {
    console.error('app-push', stage, e);
    // the failure stays visible in app_push_log (result.error, result.stage); the edition can be pushed again
    if (logKey) await db.from('app_push_log').update({ result: { error: 'server_error', stage } }).eq('key', logKey);
    const shape = e instanceof ShapeError ? { secret_shape: e.shape } : {};
    return json({ error: 'server_error', ...(authorized ? { stage, ...shape } : {}) }, 500);
  }
});
