// POST /functions/v1/app-media-sync
// Called by public.app_media_kick() (pg_net): after new tamzit_edition_elements rows and every 5 minutes (pg_cron).
// Header x-app-secret must equal app_settings.push_webhook_secret.
//
// 1. Google Drive files the engine attached to editions (ad images; English audio) → copied into the public
//    app-media bucket (drive/<id>.<ext>), because Drive links need a Google login unless the file is shared
//    "anyone with the link", and they don't stream well. Private files are retried with backoff.
// 2. Ad links → their preview image (og:image / twitter:image, like WhatsApp) copied to app-media/previews/.
// 3. Audio copies are removed after a day, so the bucket never fills up (Hebrew and French audio is not copied at
//    all: the app plays it straight from the engine's public news-audio bucket).
// The queue lives in app_media / app_link_previews (public.app_media_queue). Responds with a summary.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, env, json } from '../_shared/app-common.ts';

const BUCKET = 'app-media';
const MAX_FILE = 60 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_HTML = 768 * 1024;
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
// Sites serve their link preview tags to WhatsApp's crawler.
const PREVIEW_UA = 'WhatsApp/2.24.8.78 A';

const EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT).map(([m, e]) => [e, m]).concat([['jpeg', 'image/jpeg'], ['oga', 'audio/ogg']]),
);

class PrivateFile extends Error {}

function kindOf(mime: string): 'audio' | 'image' | 'video' | 'other' {
  if (mime.startsWith('audio/') || mime === 'application/ogg') return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'other';
}

function fileNameOf(cd: string | null): string | null {
  if (!cd) return null;
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/);
  return plain ? plain[1].trim() : null;
}

/** MIME from the header, or from the file name when the header is generic. */
function mimeOf(header: string | null, name: string | null): string {
  const h = (header ?? '').split(';')[0].trim().toLowerCase();
  if (h && h !== 'application/octet-stream' && h !== 'binary/octet-stream' && h !== 'application/binary') return h;
  const ext = name?.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new Error(`too large (${len} bytes)`);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`too large (> ${max} bytes)`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function publicUrl(path: string): string {
  return `${env('SUPABASE_URL')!.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function sha1(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Minutes until the next try: 5, 10, 20 … capped at 3 hours. */
function backoff(tries: number): string {
  const minutes = Math.min(5 * 2 ** Math.max(tries - 1, 0), 180);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// --- Drive files ------------------------------------------------------------

async function downloadDrive(id: string): Promise<{ bytes: Uint8Array; mime: string; name: string | null }> {
  let url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  for (let hop = 0; hop < 2; hop++) {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': BROWSER_UA } });
    if (res.url.includes('accounts.google.com') || res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      throw new PrivateFile('not shared: Google asks to sign in');
    }
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      throw new Error('not found on Drive');
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`Drive HTTP ${res.status}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.startsWith('text/html')) {
      // Large files get a "can't scan for viruses" page with a form that leads to the file.
      const html = new TextDecoder().decode(await readLimited(res, MAX_HTML));
      if (/accounts\.google\.com|ServiceLogin/i.test(html) && !/download-form/.test(html)) {
        throw new PrivateFile('not shared: Google asks to sign in');
      }
      const action = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/)?.[1];
      if (!action) throw new Error('Drive answered with a page instead of the file');
      const params = new URLSearchParams();
      for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) {
        params.set(m[1], m[2]);
      }
      url = `${action.replace(/&amp;/g, '&')}?${params.toString()}`;
      continue;
    }
    const name = fileNameOf(res.headers.get('content-disposition'));
    const bytes = await readLimited(res, MAX_FILE);
    return { bytes, mime: mimeOf(ct, name), name };
  }
  throw new Error('Drive kept answering with a page');
}

async function syncFile(db: SupabaseClient, id: string): Promise<string> {
  const { data: row } = await db.from('app_media').select('tries').eq('drive_id', id).maybeSingle();
  const tries = (row?.tries ?? 0) + 1;
  try {
    const { bytes, mime, name } = await downloadDrive(id);
    const kind = kindOf(mime);
    const path = `drive/${id}.${EXT[mime] ?? 'bin'}`;
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '31536000' });
    if (upErr) throw new Error(`storage: ${upErr.message}`);
    await db
      .from('app_media')
      .update({
        status: 'ok',
        kind,
        mime,
        bytes: bytes.byteLength,
        file_name: name,
        storage_path: path,
        public_url: publicUrl(path),
        error: null,
        tries,
        updated_at: new Date().toISOString(),
      })
      .eq('drive_id', id);
    return 'ok';
  } catch (e) {
    const isPrivate = e instanceof PrivateFile;
    await db
      .from('app_media')
      .update({
        status: isPrivate ? 'private' : 'failed',
        error: String((e as Error).message ?? e).slice(0, 300),
        tries,
        next_try_at: backoff(tries),
        updated_at: new Date().toISOString(),
      })
      .eq('drive_id', id);
    return isPrivate ? 'private' : 'failed';
  }
}

// --- Link previews ----------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Content of <meta property|name="key" content="…"> (either attribute order). */
function metaContent(html: string, keys: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (!key || !keys.includes(key)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content && content.trim()) return decodeEntities(content.trim());
  }
  return null;
}

const HTML_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';

/** YouTube links: the video's thumbnail (the watch page hides its preview tags from servers). */
function youtubeThumb(url: string): string | null {
  const id =
    url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] ?? null;
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

async function syncLink(db: SupabaseClient, url: string): Promise<string> {
  const { data: row } = await db.from('app_link_previews').select('tries').eq('url', url).maybeSingle();
  const tries = (row?.tries ?? 0) + 1;
  const done = (patch: Record<string, unknown>) =>
    db.from('app_link_previews').update({ ...patch, tries, updated_at: new Date().toISOString() }).eq('url', url);
  try {
    const target = new URL(url).toString(); // percent-encodes Hebrew paths
    let image: string | null = youtubeThumb(target);
    let title: string | null = null;
    let base = target;
    // The preview crawler first (sites serve it their preview tags), then as a browser: some sites block crawlers
    // or show them a page without an image.
    for (const ua of image ? [] : [PREVIEW_UA, BROWSER_UA]) {
      const page = await fetch(target, { redirect: 'follow', headers: { 'user-agent': ua, accept: HTML_ACCEPT } });
      base = page.url || target;
      const ct = page.headers.get('content-type') ?? '';
      if (ct.startsWith('image/')) {
        await page.body?.cancel().catch(() => {});
        image = base;
        break;
      }
      if (!page.ok) {
        await page.body?.cancel().catch(() => {});
        if (ua === BROWSER_UA) throw new Error(`page HTTP ${page.status}`);
        continue;
      }
      const html = new TextDecoder().decode(await readLimited(page, MAX_HTML).catch(() => new Uint8Array(0)));
      image =
        metaContent(html, ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) ??
        html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
        null;
      title = title ?? metaContent(html, ['og:title', 'twitter:title']);
      if (image) break;
    }
    if (!image) {
      await done({ status: 'none', title, error: null, next_try_at: backoff(6) });
      return 'none';
    }
    const imgUrl = new URL(image, base).toString();
    const img = await fetch(imgUrl, { redirect: 'follow', headers: { 'user-agent': BROWSER_UA, accept: 'image/*' } });
    if (!img.ok) {
      await img.body?.cancel().catch(() => {});
      throw new Error(`image HTTP ${img.status}`);
    }
    const mime = mimeOf(img.headers.get('content-type'), new URL(img.url).pathname);
    if (!mime.startsWith('image/')) {
      await img.body?.cancel().catch(() => {});
      throw new Error(`not an image (${mime})`);
    }
    const bytes = await readLimited(img, MAX_IMAGE);
    const path = `previews/${await sha1(url)}.${EXT[mime] ?? 'img'}`;
    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: true, cacheControl: '31536000' });
    if (upErr) throw new Error(`storage: ${upErr.message}`);
    await done({ status: 'ok', image_url: publicUrl(path), title, error: null });
    return 'ok';
  } catch (e) {
    await done({ status: 'failed', error: String((e as Error).message ?? e).slice(0, 300), next_try_at: backoff(tries) });
    return 'failed';
  }
}

// --- Cleanup ----------------------------------------------------------------

async function expireOldAudio(db: SupabaseClient): Promise<number> {
  // created_at = when the file was queued, i.e. minutes after the engine attached it
  const before = new Date(Date.now() - 24 * 3600_000).toISOString(); // audio is never kept longer than a day
  const { data } = await db
    .from('app_media')
    .select('drive_id, storage_path')
    .eq('status', 'ok')
    .in('kind', ['audio', 'video'])
    .lt('created_at', before)
    .limit(20);
  const rows = (data ?? []) as { drive_id: string; storage_path: string | null }[];
  const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
  for (const r of rows) {
    await db
      .from('app_media')
      .update({ status: 'expired', public_url: null, updated_at: new Date().toISOString(), tries: 999 })
      .eq('drive_id', r.drive_id);
  }
  return rows.length;
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const db = adminClient();
    const { data: secretRow } = await db.from('app_settings').select('value').eq('key', 'push_webhook_secret').maybeSingle();
    const expected = secretRow?.value ? String(secretRow.value) : '';
    if (!expected || req.headers.get('x-app-secret') !== expected) return json({ error: 'forbidden' }, 403);

    const { data: queue, error: qErr } = await db.rpc('app_media_queue', { p_limit: 12 });
    if (qErr) throw qErr;
    const files = ((queue?.files ?? []) as { drive_id: string }[]).map((f) => f.drive_id);
    const links = ((queue?.links ?? []) as { url: string }[]).map((l) => l.url);

    const summary: Record<string, number> = {};
    const count = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);
    for (const id of files) count(`file_${await syncFile(db, id)}`);
    for (const url of links) count(`link_${await syncLink(db, url)}`);
    const expired = await expireOldAudio(db);
    if (expired) summary.expired = expired;
    return json({ ok: true, ...summary });
  } catch (e) {
    console.error('app-media-sync', e);
    return json({ error: 'server_error' }, 500);
  }
});
