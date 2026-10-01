// What the reader does in the app, so the operators can see whether it serves anyone: the app opened, an edition
// read, the spoken edition played, an ad tapped, an item saved or shared, a search, a settings change, the first-run
// tour. Each event is a name and a few plain numbers; nothing of what the reader wrote and no location.
//
// Events are collected in memory and sent in one batch (app_track) when the app goes to the background, when 20 have
// piled up, or after 20 seconds. A failed send is dropped, never retried forever: this is measurement, not data the
// reader depends on. Nothing is sent for a reader who is not signed in — the server writes events per profile.
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { api } from './api';
import { supabase } from './supabase';

export type EventName =
  | 'app_open'
  | 'session_end'
  | 'edition_open'
  | 'edition_read'
  | 'item_open'
  | 'audio_play'
  | 'audio_done'
  | 'ad_click'
  | 'item_save'
  | 'item_unsave'
  | 'item_share'
  | 'item_feedback'
  | 'archive_open'
  | 'search'
  | 'settings_change'
  | 'push_open'
  | 'tour_step'
  | 'tour_done'
  | 'tour_skip'
  | 'premium_view'
  | 'donate_view';

type Props = Record<string, string | number | boolean | null | undefined>;
type Event = { name: EventName; props: Props; at: string; session_id: string; app_version?: string; platform?: string };

const MAX_QUEUE = 20;
const FLUSH_MS = 20_000;

/** One app launch. Lets the server group events into visits without any device identifier. */
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const version = (): string | undefined => {
  const v = Constants.expoConfig?.version;
  const build = (Constants.expoConfig as { android?: { versionCode?: number } } | null)?.android?.versionCode;
  return v ? (build ? `${v} (${build})` : v) : undefined;
};
export const appVersion = version();
export const appBuild = (Constants.expoConfig as { android?: { versionCode?: number } } | null)?.android?.versionCode;

let queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionStart = Date.now();

/** Records one event. Never throws and never blocks the caller. */
export function track(name: EventName, props: Props = {}) {
  queue.push({
    name,
    props: Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined && v !== null)) as Props,
    at: new Date().toISOString(),
    session_id: sessionId,
    app_version: appVersion,
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
  });
  if (queue.length >= MAX_QUEUE) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** Sends what has piled up. Called on a timer, when the queue fills, and when the app leaves the screen. */
export async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const batch = queue.slice(0, 50);
  queue = queue.slice(50);
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return; // signed out: nothing to attach the events to
    await api.track(batch);
  } catch {
    // measurement must never surface to the reader
  }
}

/** Starts the app's own listening: the opening event, and the time spent each visit. */
export function startAnalytics() {
  track('app_open', { cold: true });
  sessionStart = Date.now();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      sessionStart = Date.now();
      track('app_open', { cold: false });
    } else if (state === 'background' || state === 'inactive') {
      const seconds = Math.round((Date.now() - sessionStart) / 1000);
      if (seconds >= 2 && seconds < 4 * 3600) track('session_end', { seconds });
      void flush();
    }
  });
  return () => sub.remove();
}
