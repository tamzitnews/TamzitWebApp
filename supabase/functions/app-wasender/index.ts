// POST /functions/v1/app-wasender   (WaSender webhook: set it as the Webhook URL of each WhatsApp session)
// Header X-Webhook-Signature must equal the WASENDER_WEBHOOK_SECRET secret (the "Webhook Secret" saved in WaSender).
//
// For every image message in the event whose caption is the text of an ad sent in the last day
// (public.app_ad_element_for_caption), the image is decrypted through WaSender (POST /api/decrypt-media, needs the
// WASENDER_API_KEY secret; the link it returns lives an hour), copied to app-media/wasender/<element>.<ext> and recorded
// in app_ad_images, so the ad in the app shows the image that went out on WhatsApp. Everything else is ignored quickly:
// the webhook sees every message of the session.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, env, json } from '../_shared/app-common.ts';

const BUCKET = 'app-media';
const MAX_IMAGE = 10 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

type ImageMessage = {
  url?: string;
  mimetype?: string;
  mediaKey?: string;
  caption?: string;
  fileSha256?: string;
  fileLength?: string | number;
  fileName?: string;
};
type WaMessage = {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  message?: { imageMessage?: ImageMessage };
  messageTimestamp?: number | string;
};

/** The message objects of an event: data.messages (object or array), or data itself. */
function messagesOf(body: Record<string, unknown>): WaMessage[] {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const m = data.messages ?? data.message ?? data;
  const list = Array.isArray(m) ? m : [m];
  return list.filter((x): x is WaMessage => !!x && typeof x === 'object');
}

async function decryptUrl(msg: WaMessage, img: ImageMessage): Promise<string> {
  const res = await fetch('https://www.wasenderapi.com/api/decrypt-media', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WASENDER_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data: { messages: { key: { id: msg.key?.id }, message: { imageMessage: img } } } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`decrypt-media ${res.status}: ${text.slice(0, 200)}`);
  const out = JSON.parse(text);
  const url = out.publicUrl ?? out.data?.publicUrl ?? out.url;
  if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('decrypt-media: no publicUrl');
  return url;
}

async function handle(db: SupabaseClient, msg: WaMessage): Promise<string> {
  const img = msg.message?.imageMessage;
  const caption = img?.caption?.trim();
  if (!img || !caption) return 'not_an_image_with_caption';
  const at = msg.messageTimestamp ? new Date(Number(msg.messageTimestamp) * 1000).toISOString() : new Date().toISOString();

  const { data: elementId, error } = await db.rpc('app_ad_element_for_caption', { p_caption: caption, p_at: at });
  if (error) throw error;
  if (!elementId) return 'not_an_ad';
  const { data: have } = await db.from('app_ad_images').select('element_id').eq('element_id', elementId).maybeSingle();
  if (have) return 'already_have';

  const publicUrl = await decryptUrl(msg, img);
  const res = await fetch(publicUrl);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const mime = (res.headers.get('content-type') ?? img.mimetype ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error(`not an image (${mime})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE) throw new Error('image too large');

  const path = `wasender/${elementId}.${EXT[mime] ?? 'jpg'}`;
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '31536000' });
  if (upErr) throw new Error(`storage: ${upErr.message}`);
  const imageUrl = `${env('SUPABASE_URL')!.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;
  await db
    .from('app_ad_images')
    .upsert({ element_id: elementId, source: 'wasender', message_id: msg.key?.id ?? null, image_url: imageUrl });
  return 'saved';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = env('WASENDER_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-signature') !== secret) return json({ error: 'forbidden' }, 403);
  if (!env('WASENDER_API_KEY')) return json({ ok: true, skipped: 'no_api_key' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: true, skipped: 'not_json' });
  }
  const results: string[] = [];
  try {
    const db = adminClient();
    for (const msg of messagesOf(body)) results.push(await handle(db, msg));
    if (results.includes('saved')) console.log('app-wasender', { event: body.event, results });
    return json({ ok: true, results });
  } catch (e) {
    // Always 200 so WaSender does not retry the whole session backlog; the next send of the ad tries again.
    console.error('app-wasender', body.event, e);
    return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 200) });
  }
});
