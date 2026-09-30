// The image each ad went out with on WhatsApp, from Whapi.Cloud (the service's numbers send through it).
// Only when some ad of the last hours has no image yet (public.app_ad_images_needed) and the WHAPI_TOKEN secret is set:
// lists what the numbers sent since then (GET /messages/list?from_me=true), and for each image message whose caption
// is an ad's text (public.app_ad_element_for_caption) copies the image to app-media/whapi/<element>.<ext> and records
// it in app_ad_images. The first send of an ad wins (the same ad goes to many groups and channels).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { env } from '../_shared/app-common.ts';

const GATE = 'https://gate.whapi.cloud';
const BUCKET = 'app-media';
const MAX_IMAGE = 10 * 1024 * 1024;
const PAGE = 500;
const MAX_MESSAGES = 3000; // per number and run
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

type WhapiImage = { id?: string; link?: string; mime_type?: string; caption?: string };
type WhapiMessage = { id?: string; type?: string; timestamp?: number; image?: WhapiImage };

/** The API tokens of the sending numbers (WHAPI_TOKEN; several separated by commas, spaces or new lines). */
export function whapiTokens(): string[] {
  return (env('WHAPI_TOKEN') ?? '').split(/[\s,]+/).filter(Boolean);
}

async function listSent(token: string, fromSec: number): Promise<WhapiMessage[]> {
  const out: WhapiMessage[] = [];
  for (let offset = 0; offset < MAX_MESSAGES; offset += PAGE) {
    const url = `${GATE}/messages/list?from_me=true&time_from=${fromSec}&count=${PAGE}&offset=${offset}&sort=desc`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`whapi messages ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = ((await res.json()).messages ?? []) as WhapiMessage[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** The image bytes: the message's media link (when Whapi auto-downloads media), else GET /media/{id}. */
async function download(token: string, img: WhapiImage): Promise<{ bytes: Uint8Array; mime: string }> {
  const tries: [string, HeadersInit][] = [];
  if (img.link?.startsWith('http')) tries.push([img.link, {}]);
  if (img.id) tries.push([`${GATE}/media/${encodeURIComponent(img.id)}`, { Authorization: `Bearer ${token}` }]);
  let last = 'no media';
  for (const [url, headers] of tries) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      last = `${res.status}`;
      await res.body?.cancel();
      continue;
    }
    const mime = (res.headers.get('content-type') ?? img.mime_type ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) {
      last = `not an image (${mime})`;
      await res.body?.cancel();
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE) throw new Error('image too large');
    return { bytes, mime };
  }
  throw new Error(`download: ${last}`);
}

export async function syncWhapiAdImages(db: SupabaseClient, supabaseUrl: string): Promise<Record<string, number>> {
  const tokens = whapiTokens();
  if (!tokens.length) return {};
  const { data: need, error } = await db.rpc('app_ad_images_needed', {});
  if (error) throw error;
  const missing = new Set<number>(((need?.ids ?? []) as (number | string)[]).map(Number));
  if (!missing.size || !need?.since) return {};
  const since = Math.floor(new Date(need.since as string).getTime() / 1000) - 30 * 60;

  const summary: Record<string, number> = {};
  const count = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);
  for (const token of tokens) {
    let messages: WhapiMessage[];
    try {
      messages = await listSent(token, since);
    } catch (e) {
      console.error('app-media-sync whapi', String((e as Error).message ?? e));
      count('whapi_error');
      continue;
    }
    const images = messages
      .filter((m) => m.type === 'image' && m.image?.caption?.trim())
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    const seen = new Set<string>();
    for (const m of images) {
      const caption = m.image!.caption!.trim();
      if (seen.has(caption)) continue;
      seen.add(caption);
      const at = new Date((m.timestamp ?? Date.now() / 1000) * 1000).toISOString();
      const { data: elementId } = await db.rpc('app_ad_element_for_caption', { p_caption: caption, p_at: at });
      if (!elementId || !missing.has(Number(elementId))) continue;
      try {
        const { bytes, mime } = await download(token, m.image!);
        const path = `whapi/${elementId}.${EXT[mime] ?? 'jpg'}`;
        const { error: upErr } = await db.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '31536000' });
        if (upErr) throw new Error(`storage: ${upErr.message}`);
        await db.from('app_ad_images').upsert({
          element_id: elementId,
          source: 'whapi',
          message_id: m.id ?? null,
          image_url: `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`,
        });
        missing.delete(Number(elementId));
        count('whapi_saved');
      } catch (e) {
        console.error('app-media-sync whapi', elementId, String((e as Error).message ?? e));
        count('whapi_failed');
      }
      if (!missing.size) break;
    }
    if (!missing.size) break;
  }
  return summary;
}
