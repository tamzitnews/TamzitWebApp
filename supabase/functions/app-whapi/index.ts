// POST /functions/v1/app-whapi
//  - Whapi's webhook (event messages.post of each sending number; header x-whapi-secret = app_settings.whapi_webhook_secret):
//    every message the service sends → _shared/whapi.ts handleAll: special updates, and editions the engine did not
//    log, into tamzit_editions (they then push, show in the app and are classified), ads and their images. Always 200
//    so that Whapi does not retry.
//  - Operations (header x-app-secret = app_settings.push_webhook_secret), body { action }:
//      status    each number: channel health and its webhooks (URL, events; header names only, never values)
//      connect   adds this function to each number's webhooks (keeps the existing ones) with the secret header, and
//                saves the channels the numbers administer in app_settings.whapi_channel_ids
//      backfill  { hours } handles what the numbers sent and what was posted in those channels in the last hours
//      channels / inspect   read-only views of the channels and of what was sent (for checks; `full` → whole texts)
// Needs the WHAPI_TOKEN secret.
import { adminClient, corsHeaders, env, getSettings, json, readBody, settingText } from '../_shared/app-common.ts';
import { handleAll, listSent, messageText, ourChannels, whapi, whapiTokens, type WhapiMessage } from '../_shared/whapi.ts';

type Webhook = { url?: string; events?: { type?: string; method?: string }[]; mode?: string; headers?: Record<string, string> };

const selfUrl = () => `${env('SUPABASE_URL')!.replace(/\/$/, '')}/functions/v1/app-whapi`;
// URLs without their query (it can hold another service's token)
const describe = (w: Webhook) => ({
  url: w.url?.split('?')[0],
  has_query: !!w.url?.includes('?'),
  events: w.events,
  mode: w.mode,
  header_names: Object.keys(w.headers ?? {}),
});

async function settingsOf(token: string): Promise<{ webhooks?: Webhook[] }> {
  const res = await whapi(token, '/settings');
  if (!res.ok) throw new Error(`whapi settings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const db = adminClient();
  const settings = await getSettings(db, ['push_webhook_secret', 'whapi_webhook_secret']);
  const hookSecret = settingText(settings, 'whapi_webhook_secret', '');
  const appSecret = settingText(settings, 'push_webhook_secret', '');
  const supabaseUrl = env('SUPABASE_URL')!;

  // Whapi's webhook
  const fromWhapi = req.headers.get('x-whapi-secret');
  if (fromWhapi !== null) {
    if (!hookSecret || fromWhapi !== hookSecret) return json({ error: 'forbidden' }, 403);
    try {
      const body = await readBody(req);
      const messages = (Array.isArray(body.messages) ? body.messages : []) as WhapiMessage[];
      const summary = messages.length ? await handleAll(db, messages, supabaseUrl, { channels: await ourChannels(db) }) : {};
      if (Object.keys(summary).length) console.log('app-whapi', summary);
      return json({ ok: true, ...summary });
    } catch (e) {
      console.error('app-whapi webhook', e);
      return json({ ok: false });
    }
  }

  // Operations
  if (!appSecret || req.headers.get('x-app-secret') !== appSecret) return json({ error: 'forbidden' }, 403);
  const tokens = whapiTokens();
  if (!tokens.length) return json({ error: 'no_whapi_token' }, 400);
  const body = await readBody(req);
  try {
    if (body.action === 'status' || body.action === 'connect') {
      const numbers = [];
      for (const [i, token] of tokens.entries()) {
        const health = await whapi(token, '/health');
        const healthBody = health.ok ? await health.json() : { http: health.status };
        const s = await settingsOf(token);
        let webhooks = s.webhooks ?? [];
        let changed = false;
        if (body.action === 'connect' && !webhooks.some((w) => w.url === selfUrl())) {
          if (!hookSecret) throw new Error('whapi_webhook_secret missing');
          webhooks = [...webhooks, {
            url: selfUrl(),
            events: [{ type: 'messages', method: 'post' }],
            mode: 'body',
            headers: { 'x-whapi-secret': hookSecret },
          }];
          const res = await whapi(token, '/settings', { method: 'PATCH', body: JSON.stringify({ webhooks }) });
          if (!res.ok) throw new Error(`whapi update settings ${res.status}: ${(await res.text()).slice(0, 300)}`);
          changed = true;
          webhooks = (await settingsOf(token)).webhooks ?? [];
        }
        if (body.action === 'connect') {
          // the channels this number administers: their posts (special updates by editors) count too
          const nr = await whapi(token, '/newsletters?count=100');
          const list = (nr.ok ? ((await nr.json()).newsletters ?? []) : []) as Record<string, unknown>[];
          const admin = list.filter((n) => ['admin', 'owner'].includes(String(n.role ?? '').toLowerCase())).map((n) => String(n.id));
          const known = await ourChannels(db);
          const merged = [...new Set([...known, ...admin])];
          if (merged.length !== known.size) {
            const { error } = await db.from('app_settings').update({ value: merged }).eq('key', 'whapi_channel_ids');
            if (error) throw error;
          }
        }
        numbers.push({
          number: i + 1,
          status: healthBody?.status ?? healthBody,
          user: healthBody?.user ? { id: healthBody.user.id, name: healthBody.user.name } : undefined,
          connected: webhooks.some((w) => w.url === selfUrl()),
          changed,
          webhooks: webhooks.map(describe),
        });
      }
      return json({ ok: true, numbers });
    }
    if (body.action === 'channels') {
      // the WhatsApp channels the numbers see, and the newest posts of those named in `ids` (or all), with `text`
      const q = typeof body.text === 'string' ? body.text : '';
      const out = [];
      for (const token of tokens) {
        const res = await whapi(token, '/newsletters?count=100');
        const list = res.ok ? ((await res.json()).newsletters ?? []) : [];
        for (const n of list as Record<string, unknown>[]) {
          const entry: Record<string, unknown> = {
            id: n.id, name: n.name, subscribers: n.subscribers_count, role: n.role ?? (n.viewer_metadata as Record<string, unknown> | undefined)?.role,
          };
          if (!Array.isArray(body.ids) || body.ids.includes(n.id)) {
            const mr = await whapi(token, `/newsletters/${encodeURIComponent(String(n.id))}/messages?count=${Math.min(Number(body.count) || 50, 500)}`);
            const msgs = (mr.ok ? ((await mr.json()).messages ?? []) : []) as WhapiMessage[];
            entry.messages = msgs.length;
            entry.from_me = msgs.filter((m) => m.from_me).length;
            // newest first; `full` gives the whole text
            entry.matches = msgs.filter((m) => !q || messageText(m).includes(q))
              .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 10).map((m) => ({
                id: m.id, type: m.type, from_me: m.from_me, at: new Date((m.timestamp ?? 0) * 1000).toISOString(),
                text: messageText(m).slice(0, body.full ? 8000 : 120),
              }));
          }
          out.push(entry);
        }
      }
      return json({ ok: true, channels: out });
    }
    if (body.action === 'inspect') {
      // what the numbers sent: counts by chat kind and message type, and the messages containing `text`
      const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 14);
      const since = Math.floor(Date.now() / 1000 - hours * 3600);
      const q = typeof body.text === 'string' ? body.text : '';
      const counts: Record<string, number> = {};
      const matches = [];
      for (const token of tokens) {
        for (const m of await listSent(token, since)) {
          const kind = (m.chat_id ?? '').split('@')[1] ?? 'unknown';
          counts[`${kind}/${m.type}`] = (counts[`${kind}/${m.type}`] ?? 0) + 1;
          const t = messageText(m);
          if (q && t.includes(q)) {
            matches.push({ kind, type: m.type, at: new Date((m.timestamp ?? 0) * 1000).toISOString(), text: t.slice(0, body.full ? 8000 : 160) });
          }
        }
      }
      return json({ ok: true, hours, counts, matches: matches.slice(0, 20) });
    }
    if (body.action === 'backfill') {
      const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 14);
      const since = Math.floor(Date.now() / 1000 - hours * 3600);
      const channels = await ourChannels(db);
      const summary: Record<string, number> = {};
      for (const token of tokens) {
        const messages = await listSent(token, since);
        for (const id of channels) {
          // the channel's history (posts by any admin), newest first
          const res = await whapi(token, `/newsletters/${encodeURIComponent(id)}/messages?count=500`);
          if (!res.ok) continue;
          for (const m of ((await res.json()).messages ?? []) as WhapiMessage[]) {
            if ((m.timestamp ?? 0) >= since) messages.push({ ...m, chat_id: m.chat_id ?? id });
          }
        }
        const s = await handleAll(db, messages, supabaseUrl, { channels });
        for (const [k, v] of Object.entries(s)) summary[k] = (summary[k] ?? 0) + v;
      }
      return json({ ok: true, hours, channels: channels.size, ...summary });
    }
    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    console.error('app-whapi', e);
    return json({ error: String((e as Error).message ?? e).slice(0, 300) }, 502);
  }
});
