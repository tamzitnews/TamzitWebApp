// Whapi.Cloud (the service's WhatsApp numbers send through it): what the app takes from the messages sent.
//  - a special update ("📻 *עדכון מיוחד*" …) → one tamzit_editions row per distinct text, as the engine used to write
//    it (the engine stopped logging special updates on 2026-08-18);
//  - a regular edition ("📻 *תמצית החדשות*" / "*מהדורת ערב, …*", English, French) the engine did not log → its
//    tamzit_editions row, and its sponsor message ("> המהדורה בחסות: …") → its ad element (migration 0024; the
//    engine sometimes sends an edition without logging it, e.g. the evening edition of 2026-09-30);
//  - an image whose caption is an ad's text → the ad's image (app-media/whapi/<element>.<ext>, app_ad_images).
// All three in SQL (public.app_ingest_sent), one call per message.
// A message counts when a number sent it, or when it was posted in one of the service's WhatsApp channels
// (app_settings.whapi_channel_ids; editors post special updates there from their own phones).
// Used by app-whapi (Whapi's webhook, per message as it is sent) and app-media-sync (after an ad element is saved,
// in case its message arrived first). Secret WHAPI_TOKEN: the API token of each sending number, several separated by
// commas.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { env } from './app-common.ts';

export const GATE = 'https://gate.whapi.cloud';
const BUCKET = 'app-media';
const MAX_IMAGE = 10 * 1024 * 1024;
const PAGE = 500;
const MAX_MESSAGES = 3000; // per number and call
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

type WhapiMedia = { id?: string; link?: string; mime_type?: string; caption?: string };
export type WhapiMessage = {
  id?: string;
  type?: string;
  from_me?: boolean;
  chat_id?: string;
  timestamp?: number;
  text?: { body?: string };
  link_preview?: { body?: string };
  image?: WhapiMedia;
  video?: WhapiMedia;
};

export function whapiTokens(): string[] {
  return (env('WHAPI_TOKEN') ?? '').split(/[\s,]+/).filter(Boolean);
}

export async function whapi(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${GATE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

/** Messages the number sent since `fromSec` (newest first, paged). */
export async function listSent(token: string, fromSec: number): Promise<WhapiMessage[]> {
  const out: WhapiMessage[] = [];
  for (let offset = 0; offset < MAX_MESSAGES; offset += PAGE) {
    const res = await whapi(token, `/messages/list?from_me=true&time_from=${fromSec}&count=${PAGE}&offset=${offset}&sort=desc`);
    if (!res.ok) throw new Error(`whapi messages ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = ((await res.json()).messages ?? []) as WhapiMessage[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** The text of a message: its body, or the caption of its image / video. */
export function messageText(m: WhapiMessage): string {
  return (m.text?.body ?? m.link_preview?.body ?? m.image?.caption ?? m.video?.caption ?? '').trim();
}

const whenOf = (m: WhapiMessage) => new Date((m.timestamp ?? Date.now() / 1000) * 1000).toISOString();

/** The image bytes: the message's media link (when Whapi auto-downloads media), else GET /media/{id} (any number). */
async function downloadImage(tokens: string[], img: WhapiMedia): Promise<{ bytes: Uint8Array; mime: string }> {
  const tries: [string, HeadersInit][] = [];
  if (img.link?.startsWith('http')) tries.push([img.link, {}]);
  if (img.id) for (const t of tokens) tries.push([`${GATE}/media/${encodeURIComponent(img.id)}`, { Authorization: `Bearer ${t}` }]);
  let last = 'no media';
  for (const [url, headers] of tries) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    const mime = (res.headers.get('content-type') ?? img.mime_type ?? '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !mime.startsWith('image/')) {
      last = res.ok ? `not an image (${mime})` : `${res.status}`;
      await res.body?.cancel();
      continue;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE) throw new Error('image too large');
    return { bytes, mime };
  }
  throw new Error(`download: ${last}`);
}

export type Outcome =
  | 'special_saved'
  | 'special_known'
  | 'edition_parked'
  | 'edition_known'
  | 'ad_saved'
  | 'ad_image_saved'
  | 'ad_image_known'
  | 'other'
  | 'test'
  | 'failed';
// ignore: chats where what the numbers send is a test (app_settings.whapi_test_chat_ids)
export type Scope = { channels: Set<string>; ignore?: Set<string>; onlyAds?: Set<number> };

/** The service's WhatsApp channels (app_settings.whapi_channel_ids). */
export async function ourChannels(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'whapi_channel_ids').maybeSingle();
  return new Set(Array.isArray(data?.value) ? (data.value as string[]) : []);
}

/** Test groups (app_settings.whapi_test_chat_ids): what a number sends there is a test, never an edition, ad or update. */
export async function testChats(db: SupabaseClient): Promise<Set<string>> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'whapi_test_chat_ids').maybeSingle();
  return new Set(Array.isArray(data?.value) ? (data.value as string[]).map((x) => String(x).trim()) : []);
}

/** Both lists a handler needs. */
export async function sentScope(db: SupabaseClient): Promise<Scope> {
  const [channels, ignore] = await Promise.all([ourChannels(db), testChats(db)]);
  return { channels, ignore };
}

/**
 * One message sent by a number or posted in one of the service's channels: a special update, or an edition the
 * engine did not log, is written (once); a sponsor message of such an edition becomes its ad; an image whose caption
 * is an ad's text gives that ad its image. `scope.onlyAds`: consider only these ad elements (app-media-sync's list
 * of ads still without an image). Anything else returns at once, without a query.
 */
export async function handleSent(db: SupabaseClient, m: WhapiMessage, supabaseUrl: string, scope: Scope): Promise<Outcome> {
  const onlyAds = scope.onlyAds;
  if (m.chat_id && scope.ignore?.has(m.chat_id)) return 'test';
  if (m.from_me !== true && !(m.chat_id && scope.channels.has(m.chat_id))) return 'other';
  const text = messageText(m);
  if (!text) return 'other';
  try {
    let adSaved = false;
    if (!onlyAds) {
      const { data: r, error } = await db.rpc('app_ingest_sent', { p_text: text, p_at: whenOf(m), p_message_id: m.id ?? null });
      if (error) throw error;
      if (r?.kind === 'special') return r.id ? 'special_saved' : 'special_known';
      // since 0031 an edition is never written on arrival: it waits for the engine (app_whapi_pending)
      if (r?.kind === 'edition') return r.parked ? 'edition_parked' : 'edition_known';
      adSaved = r?.kind === 'ad' && !!r.id; // an image with it is the ad's image (below)
    }
    if (m.type !== 'image' || !m.image) return adSaved ? 'ad_saved' : 'other';
    const { data: elementId, error } = await db.rpc('app_ad_element_for_caption', { p_caption: text, p_at: whenOf(m) });
    if (error) throw error;
    if (!elementId || (onlyAds && !onlyAds.has(Number(elementId)))) return 'other';
    const { data: have } = await db.from('app_ad_images').select('element_id').eq('element_id', elementId).maybeSingle();
    if (have) return 'ad_image_known';
    const { bytes, mime } = await downloadImage(whapiTokens(), m.image);
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
    onlyAds?.delete(Number(elementId));
    return 'ad_image_saved';
  } catch (e) {
    console.error('whapi message', m.id, String((e as Error).message ?? e));
    return 'failed';
  }
}

/** Handles messages oldest first (the first send of an ad or special wins); counts the outcomes. */
export async function handleAll(
  db: SupabaseClient,
  messages: WhapiMessage[],
  supabaseUrl: string,
  scope: Scope,
): Promise<Record<string, number>> {
  const onlyAds = scope.onlyAds;
  const summary: Record<string, number> = {};
  const seen = new Set<string>();
  for (const m of [...messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))) {
    const key = `${m.type}:${messageText(m)}`;
    if (seen.has(key)) continue; // the same message to many groups
    seen.add(key);
    const r = await handleSent(db, m, supabaseUrl, scope);
    if (r !== 'other') summary[r] = (summary[r] ?? 0) + 1;
    if (onlyAds && !onlyAds.size) break;
  }
  return summary;
}

/** app-media-sync: ads of the last hours still without an image → look for them among the messages sent since. */
export async function syncWhapiAdImages(db: SupabaseClient, supabaseUrl: string): Promise<Record<string, number>> {
  const tokens = whapiTokens();
  if (!tokens.length) return {};
  const { data: need, error } = await db.rpc('app_ad_images_needed', {});
  if (error) throw error;
  const missing = new Set<number>(((need?.ids ?? []) as (number | string)[]).map(Number));
  if (!missing.size || !need?.since) return {};
  const since = Math.floor(new Date(need.since as string).getTime() / 1000) - 30 * 60;
  const summary: Record<string, number> = {};
  for (const token of tokens) {
    try {
      const s = await handleAll(db, await listSent(token, since), supabaseUrl, { channels: new Set(), onlyAds: missing });
      for (const [k, v] of Object.entries(s)) summary[`whapi_${k}`] = (summary[`whapi_${k}`] ?? 0) + v;
    } catch (e) {
      console.error('app-media-sync whapi', String((e as Error).message ?? e));
      summary.whapi_error = (summary.whapi_error ?? 0) + 1;
    }
    if (!missing.size) break;
  }
  return summary;
}
