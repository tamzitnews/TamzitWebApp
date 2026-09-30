// POST /functions/v1/app-classify   (pg_cron every 5 minutes, and app_tamzit_editions_classify right after an edition
// is saved). Header x-app-secret must equal app_settings.push_webhook_secret.
//
// Classifies the news items that have no label yet (public.app_label_queue claims them) with Jev, TypeSafe's
// non-generative decision model (POST https://api.typesafe.ai/v1/systemone, secret TYPESAFE_API_KEY). One request per
// item, all questions together (Jev reads the item once and answers them in parallel):
//   topic_<id>  Noul (yes/no) per active topic of app_topics, with the definition from app_settings.jev_rubric;
//   importance  Score with three ordered levels: general, important, critical.
// Results → app_item_labels: topics at or above jev_topic_threshold (most likely first), every probability, the
// importance level with the highest probability and its confidence, the model version. A failed item is retried
// later with a growing delay.
//
// Body { "test": { "lang": "he", "section"?, "headline"?, "text" } } classifies one text and returns the raw answers
// without storing anything (to try the rubric).
// Without TYPESAFE_API_KEY, or with jev_enabled false → 200 { skipped }.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { adminClient, corsHeaders, env, getSettings, json, readBody, settingText } from '../_shared/app-common.ts';

const API = 'https://api.typesafe.ai/v1/systemone';
const LEVELS = ['general', 'important', 'critical'] as const;
const LANG_NAME: Record<string, string> = { he: 'Hebrew', en: 'English', fr: 'French' };
const BUDGET_MS = 45_000; // stay well inside the edge function limit; the rest waits for the next run
const BATCH = 16;
const CONCURRENCY = 4;

type Level = (typeof LEVELS)[number];
type Topic = { id: string; name_en: string };
type Rubric = {
  topics?: Record<string, { covers?: string; not_for?: string }>;
  importance?: { instructions?: string; levels?: string[] };
};
type QueueItem = {
  hash: string;
  lang: string;
  section: string | null;
  subsection: string | null;
  headline: string | null;
  body: string;
};
type Answer = { type: string; noul?: number; probabilities?: Record<string, number>; confidence?: number };
type JevResponse = { model: string; answers: Record<string, Answer>; usage?: { input_tokens?: number } };

const DEFAULT_IMPORTANCE = {
  instructions: 'How important is this news item for a reader in Israel today?',
  levels: [
    'General: routine, local or soft news; interesting background that changes nothing for most readers today.',
    'Important: significant news most readers in Israel would want to know today, without immediate danger or a need to act.',
    'Critical: breaking or exceptional news of major national impact, or news that requires readers to act or take care now (war events, attacks with casualties, rocket alerts and Home Front instructions, major disasters, emergency decisions).',
  ],
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FatalError extends Error {}

/** One Jev request; retries 429 / 529 / 5xx twice (Retry-After or 1 s, 2 s). A 401 stops the whole run. */
async function ask(apiKey: string, body: unknown): Promise<JevResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return (await res.json()) as JevResponse;
    const text = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new FatalError(`typesafe ${res.status}: ${text}`);
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 2) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`typesafe ${res.status}: ${text}`);
  }
}

function questions(topics: Topic[], rubric: Rubric): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const t of topics) {
    const r = rubric.topics?.[t.id] ?? {};
    q[`topic_${t.id}`] = {
      type: 'noul',
      instructions: `Is this news item about ${t.name_en}?`,
      criteria: {
        true: r.covers ? `It is about ${t.name_en}: ${r.covers}` : `It is about ${t.name_en}.`,
        false: r.not_for ? `It is not about ${t.name_en}. Not ${t.name_en}: ${r.not_for}` : `It is not about ${t.name_en}.`,
      },
    };
  }
  const imp = rubric.importance ?? {};
  const levels = Array.isArray(imp.levels) && imp.levels.length === 3 && imp.levels.every((l) => typeof l === 'string')
    ? imp.levels
    : DEFAULT_IMPORTANCE.levels;
  q.importance = { type: 'score', instructions: imp.instructions || DEFAULT_IMPORTANCE.instructions, criteria: levels };
  return q;
}

/** The item as Jev reads it: only what it needs (extra detail lowers accuracy). */
function state(it: { lang: string; section?: string | null; subsection?: string | null; headline?: string | null; body: string }) {
  const s: Record<string, string> = { language: LANG_NAME[it.lang] ?? it.lang };
  const section = [it.section, it.subsection].filter(Boolean).join(' / ');
  if (section) s.section = section;
  if (it.headline) s.headline = it.headline;
  s.text = it.body;
  return s;
}

function readAnswers(out: JevResponse, topics: Topic[], threshold: number) {
  const topicProbs: Record<string, number> = {};
  for (const t of topics) {
    const a = out.answers?.[`topic_${t.id}`];
    if (a && typeof a.noul === 'number') topicProbs[t.id] = Math.round(a.noul * 1000) / 1000;
  }
  const chosen = Object.entries(topicProbs)
    .filter(([, p]) => p >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  const imp = out.answers?.importance;
  const p = imp?.probabilities ?? {};
  const importanceProbs: Record<string, number> = {};
  LEVELS.forEach((level, i) => (importanceProbs[level] = Math.round((p[String(i)] ?? 0) * 1000) / 1000));
  let importance: Level | null = null;
  for (const level of LEVELS) if (importance === null || importanceProbs[level] > importanceProbs[importance]) importance = level;
  if (!imp?.probabilities) importance = null;
  return {
    topics: chosen,
    topic_probs: topicProbs,
    importance,
    importance_probs: imp?.probabilities ? importanceProbs : null,
    importance_confidence: typeof imp?.confidence === 'number' ? imp.confidence : null,
  };
}

async function classifyOne(
  db: SupabaseClient,
  apiKey: string,
  model: string,
  topics: Topic[],
  q: Record<string, unknown>,
  threshold: number,
  it: QueueItem,
): Promise<'ok' | 'failed'> {
  try {
    const out = await ask(apiKey, { model, state: state(it), questions: q });
    const r = readAnswers(out, topics, threshold);
    const { error } = await db
      .from('app_item_labels')
      .update({
        status: 'ok',
        ...r,
        model: out.model ?? model,
        input_tokens: out.usage?.input_tokens ?? null,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('text_hash', it.hash);
    if (error) throw error;
    return 'ok';
  } catch (e) {
    const { data: row } = await db.from('app_item_labels').select('tries').eq('text_hash', it.hash).maybeSingle();
    const tries = (row?.tries as number | undefined) ?? 1;
    const delayMin = e instanceof FatalError ? 60 : Math.min(5 * 2 ** (tries - 1), 360);
    await db
      .from('app_item_labels')
      .update({
        status: 'failed',
        error: String((e as Error).message ?? e).slice(0, 300),
        next_try_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('text_hash', it.hash);
    if (e instanceof FatalError) throw e;
    return 'failed';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const started = Date.now();
  try {
    const db = adminClient();
    const settings = await getSettings(db, [
      'push_webhook_secret', 'jev_enabled', 'jev_model', 'jev_topic_threshold', 'jev_rubric',
    ]);
    const expected = settingText(settings, 'push_webhook_secret', '');
    if (!expected || req.headers.get('x-app-secret') !== expected) return json({ error: 'forbidden' }, 403);
    const body = await readBody(req);

    const apiKey = env('TYPESAFE_API_KEY');
    if (!apiKey) return json({ skipped: true, reason: 'no_api_key' });
    if (settings.jev_enabled === false && !body.test) return json({ skipped: true, reason: 'disabled' });

    const model = settingText(settings, 'jev_model', 'jev-1.13.0');
    const threshold = num(settings.jev_topic_threshold, 0.7, 0.3, 0.99);
    const rubric = (settings.jev_rubric && typeof settings.jev_rubric === 'object' ? settings.jev_rubric : {}) as Rubric;
    const { data: topicRows, error: tErr } = await db.from('app_topics').select('id, name_en').eq('active', true).order('sort');
    if (tErr) throw tErr;
    const topics = (topicRows ?? []) as Topic[];
    const q = questions(topics, rubric);

    // Try the rubric on one text (nothing stored).
    if (body.test && typeof body.test === 'object') {
      const t = body.test as Record<string, unknown>;
      const text = typeof t.text === 'string' ? t.text : '';
      if (!text.trim()) return json({ error: 'missing_text' }, 400);
      const lang = typeof t.lang === 'string' && LANG_NAME[t.lang] ? t.lang : 'he';
      const out = await ask(apiKey, {
        model,
        state: state({
          lang,
          section: typeof t.section === 'string' ? t.section : null,
          headline: typeof t.headline === 'string' ? t.headline : null,
          body: text,
        }),
        questions: q,
      });
      return json({ ...readAnswers(out, topics, threshold), model: out.model, usage: out.usage, ms: Date.now() - started });
    }

    const summary = { ok: 0, failed: 0 };
    while (Date.now() - started < BUDGET_MS) {
      const { data: queue, error: qErr } = await db.rpc('app_label_queue', { p_limit: BATCH });
      if (qErr) throw qErr;
      const items = (queue ?? []) as QueueItem[];
      if (!items.length) break;
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const results = await Promise.all(
          items.slice(i, i + CONCURRENCY).map((it) => classifyOne(db, apiKey, model, topics, q, threshold, it)),
        );
        for (const r of results) summary[r]++;
      }
      if (items.length < BATCH) break;
    }
    if (summary.ok || summary.failed) console.log('app-classify', { ...summary, ms: Date.now() - started });
    return json({ ok: true, ...summary });
  } catch (e) {
    console.error('app-classify', e);
    return json({ error: e instanceof FatalError ? 'api_key_rejected' : 'server_error' }, e instanceof FatalError ? 502 : 500);
  }
});
