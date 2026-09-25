// Notifications: one local "edition is ready" notification per edition slot, never during Shabbat or
// Yom Tov, plus one Motzei Shabbat notification after havdalah; and the device push token (FCM) for
// the server-sent "special update" pushes.
//
// Local notifications are scheduled on the device for the next 7 days and re-scheduled whenever the
// profile, the Shabbat city or the app state changes (useNotificationSync). They work without
// Firebase; push registration fails gracefully when google-services.json is missing.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useShabbatCity } from '@/features/shabbat/hooks';
import { usePrefs } from '@/state/prefs';
import { useSession } from '@/state/session';
import { api } from './api';
import { EDITION_NAMES, slotEditionType } from './i18n';
import { useMe } from './queries';
import { slotsBetween } from './schedule';
import { MOTZASH_DELAY_MIN, motzashEditionAt, restPeriods } from './shabbat';
import { supabase } from './supabase';
import type { City, EditionType, Language, Profile } from './types';

const IS_NATIVE = Platform.OS === 'android' || Platform.OS === 'ios';

/** Android channel for the scheduled edition notifications. */
export const CHANNEL_EDITIONS = 'editions';
/** Android channel for "special update" pushes (the server sends them with this channel id). */
export const CHANNEL_SPECIAL = 'special';

const ID_PREFIX = 'tz-edition:';
const DAYS_AHEAD = 7;
/** Regular slots this long after the Motzei Shabbat edition are skipped (it already covers them). */
const AFTER_MOTZASH_QUIET_MIN = 60;

// Foreground presentation: a quiet banner, no sound, never a badge (no counter on the app icon).
if (IS_NATIVE) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// ---------------------------------------------------------------- Strings

const TEXT: Record<
  Language,
  {
    channelEditions: string;
    channelEditionsDesc: string;
    channelSpecial: string;
    channelSpecialDesc: string;
    ready: (edition: string) => string;
    motzashChag: string;
    body: string;
    bodyMotzash: string;
    bodyMotzashChag: string;
  }
> = {
  he: {
    channelEditions: 'מהדורות',
    channelEditionsDesc: 'התראה אחת כשהמהדורה שלכם מוכנה, בשעות שבחרתם',
    channelSpecial: 'עדכון מיוחד',
    channelSpecialDesc: 'רק באירוע חריג, מחוץ ללוח הזמנים',
    ready: (e) => `${e} מוכנה`,
    motzashChag: 'מהדורת מוצאי החג',
    body: 'כמה דקות, ואתם מעודכנים.',
    bodyMotzash: 'מה שקרה בשבת, בקצרה.',
    bodyMotzashChag: 'מה שקרה בחג, בקצרה.',
  },
  en: {
    channelEditions: 'Editions',
    channelEditionsDesc: 'One notification when your edition is ready, at the times you chose',
    channelSpecial: 'Special update',
    channelSpecialDesc: 'Only for an exceptional event, outside the schedule',
    ready: (e) => `${e} is ready`,
    motzashChag: 'After-holiday edition',
    body: 'A few minutes, and you’re up to date.',
    bodyMotzash: 'What happened over Shabbat, in brief.',
    bodyMotzashChag: 'What happened over the holiday, in brief.',
  },
  fr: {
    channelEditions: 'Éditions',
    channelEditionsDesc: 'Une notification quand votre édition est prête, aux heures choisies',
    channelSpecial: 'Mise à jour spéciale',
    channelSpecialDesc: 'Seulement pour un événement exceptionnel, hors du programme',
    ready: (e) => `Votre ${e.charAt(0).toLowerCase()}${e.slice(1)} est prête`,
    motzashChag: 'Édition de fin de fête',
    body: 'Quelques minutes, et vous êtes à jour.',
    bodyMotzash: 'Ce qui s’est passé pendant Chabbat, en bref.',
    bodyMotzashChag: 'Ce qui s’est passé pendant la fête, en bref.',
  },
};

// ---------------------------------------------------------------- Schedule (pure)

export type PlannedEdition = {
  at: Date;
  type: EditionType;
  /** For 'motzash' only: the rest period was Yom Tov without Shabbat. */
  afterChag?: boolean;
};

/**
 * The reader's edition times between `from` and `to`: every slot outside Shabbat / Yom Tov, plus a
 * Motzei Shabbat edition MOTZASH_DELAY_MIN after havdalah. Slots up to an hour after that edition
 * are skipped, since it already sums up the day.
 */
export function upcomingEditions(
  slotTimes: string[],
  frequency: 1 | 2 | 3,
  city: City | undefined,
  from: Date,
  to: Date,
): PlannedEdition[] {
  let periods: ReturnType<typeof restPeriods> = [];
  try {
    periods = restPeriods(city, new Date(from.getTime() - 2 * 24 * 3600_000), to);
  } catch {
    periods = [];
  }
  const out: PlannedEdition[] = [];
  for (const slot of slotsBetween(slotTimes, from, to)) {
    const t = slot.at.getTime();
    const quiet = periods.some(
      (p) => t >= p.start.getTime() && t < p.end.getTime() + (MOTZASH_DELAY_MIN + AFTER_MOTZASH_QUIET_MIN) * 60_000,
    );
    if (!quiet) out.push({ at: slot.at, type: slotEditionType(frequency, slot.index) });
  }
  for (const p of periods) {
    const at = motzashEditionAt(p.end);
    if (at > from && at <= to) out.push({ at, type: 'motzash', afterChag: !p.includesShabbat });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The next edition the reader will get (for "the change takes effect from the next edition, at 20:00"). */
export function nextEditionAt(slotTimes: string[], frequency: 1 | 2 | 3, city: City | undefined, now = new Date()) {
  const list = upcomingEditions(slotTimes, frequency, city, new Date(now.getTime() + 1000), new Date(now.getTime() + 4 * 24 * 3600_000));
  return list[0] ?? null;
}

function contentFor(e: PlannedEdition, lang: Language): Notifications.NotificationContentInput {
  const t = TEXT[lang] ?? TEXT.he;
  const name = e.type === 'motzash' && e.afterChag ? t.motzashChag : EDITION_NAMES[lang][e.type];
  return {
    title: t.ready(name),
    body: e.type === 'motzash' ? (e.afterChag ? t.bodyMotzashChag : t.bodyMotzash) : t.body,
    data: { kind: 'edition', edition_type: e.type, url: '/(tabs)' },
  };
}

// ---------------------------------------------------------------- Channels & permission

let channelsLang: Language | null = null;

/** Creates (or renames) the Android channels. Must exist before the permission prompt on Android 13+. */
export async function ensureChannels(lang: Language = usePrefs.getState().language) {
  if (Platform.OS !== 'android' || channelsLang === lang) return;
  const t = TEXT[lang] ?? TEXT.he;
  await Notifications.setNotificationChannelAsync(CHANNEL_EDITIONS, {
    name: t.channelEditions,
    description: t.channelEditionsDesc,
    importance: Notifications.AndroidImportance.DEFAULT,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_SPECIAL, {
    name: t.channelSpecial,
    description: t.channelSpecialDesc,
    importance: Notifications.AndroidImportance.HIGH,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelsLang = lang;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** Current OS permission, without asking. */
export async function getNotificationPermission(): Promise<PermissionState> {
  if (!IS_NATIVE) return 'unavailable';
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

// ---------------------------------------------------------------- Push token

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

let registeredFor: string | null = null;

/** Sends the device push token to the server for the signed-in user. Returns false if no token. */
async function uploadPushToken(force = false): Promise<boolean> {
  let token: string;
  try {
    const t = await withTimeout(Notifications.getDevicePushTokenAsync(), 10_000);
    token = typeof t.data === 'string' ? t.data : JSON.stringify(t.data);
  } catch {
    // No Firebase config (google-services.json), Expo Go, emulator without Play services, …
    return false;
  }
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return true; // registered on the next sign-in by useNotificationSync
  const key = `${uid}:${token}`;
  if (!force && registeredFor === key) return true;
  try {
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    registeredFor = key;
  } catch {
    // network / server error: retried on the next foreground
  }
  return true;
}

const resyncListeners = new Set<() => void>();

/**
 * Asks for permission (if not asked yet) and registers the push token with the server.
 * - 'granted': permission granted and the push token was obtained.
 * - 'denied': the reader said no (or turned notifications off in the system settings).
 * - 'unavailable': no push on this device/build (web, Expo Go, no Firebase config). If permission
 *   was granted, the local edition notifications still work.
 */
export async function registerForPush(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!IS_NATIVE) return 'unavailable';
  try {
    await ensureChannels();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
  } catch {
    return 'unavailable';
  }
  resyncListeners.forEach((l) => l()); // schedule the local notifications right away
  return (await uploadPushToken(true)) ? 'granted' : 'unavailable';
}

// ---------------------------------------------------------------- Local edition notifications

type NotifProfile = Pick<Profile, 'slot_times' | 'frequency' | 'language' | 'edition_push'>;

let queue: Promise<void> = Promise.resolve();
let lastLanguage: Language | null = null;

/** Cancels the scheduled edition notifications (e.g. on sign-out). */
export async function cancelEditionNotifications() {
  if (!IS_NATIVE) return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all.filter((n) => n.identifier.startsWith(ID_PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  lastLanguage = null;
}

async function doSync(profile: NotifProfile, city?: City) {
  await ensureChannels(profile.language);
  const perm = await Notifications.getPermissionsAsync();
  const now = new Date();
  const plan =
    perm.granted && profile.edition_push
      ? upcomingEditions(profile.slot_times, profile.frequency, city, new Date(now.getTime() + 30_000), new Date(now.getTime() + DAYS_AHEAD * 24 * 3600_000))
      : [];
  const wanted = plan.map((e) => ({ id: `${ID_PREFIX}${e.at.toISOString()}:${e.type}`, e }));
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) => n.identifier.startsWith(ID_PREFIX));
  const scheduledIds = new Set(scheduled.map((n) => n.identifier));
  const wantedIds = new Set(wanted.map((w) => w.id));
  // After a language change (or on the first sync of this launch) every text is rewritten.
  const sameLanguage = lastLanguage === profile.language;

  // Cancel what is no longer wanted, then add what is missing.
  await Promise.all(
    scheduled
      .filter((n) => !wantedIds.has(n.identifier) || !sameLanguage)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  for (const w of wanted) {
    if (sameLanguage && scheduledIds.has(w.id)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: w.id,
      content: contentFor(w.e, profile.language),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: w.e.at, channelId: CHANNEL_EDITIONS },
    });
  }
  lastLanguage = profile.language;
}

/**
 * Re-schedules the local "edition is ready" notifications for the next 7 days: one per slot outside
 * Shabbat / Yom Tov, plus the Motzei Shabbat edition. Respects edition_push and the OS permission
 * (never asks). Safe to call often: calls are serialized and only the difference is re-scheduled.
 */
export async function syncEditionNotifications(profile: NotifProfile, city?: City): Promise<void> {
  if (!IS_NATIVE) return;
  queue = queue.then(() => doSync(profile, city)).catch(() => {});
  return queue;
}

// ---------------------------------------------------------------- Hook

// Only native builds deliver notification responses; on web the hook is a no-op.
const useLastResponse: () => Notifications.NotificationResponse | null | undefined = IS_NATIVE
  ? Notifications.useLastNotificationResponse
  : () => null;

/**
 * Keeps the local edition notifications in sync with the profile and the Shabbat city, re-syncs
 * when the app returns to the foreground, registers the push token for the signed-in user, and
 * opens the edition tab when a notification is tapped. Mount once, in the tabs layout.
 */
export function useNotificationSync() {
  const { session } = useSession();
  const me = useMe(!!session);
  const city = useShabbatCity();
  const localSlots = usePrefs((s) => s.slotTimes);
  const localFrequency = usePrefs((s) => s.frequency);
  const localLanguage = usePrefs((s) => s.language);
  const profile = me.data?.profile;

  // Signed in: the server profile. Before sign-in: the local onboarding preferences.
  const slots = (profile?.slot_times ?? localSlots).join(',');
  const frequency = profile?.frequency ?? localFrequency;
  const language = profile?.language ?? localLanguage;
  const editionPush = profile?.edition_push ?? true;
  const input: NotifProfile = useMemo(
    () => ({ slot_times: slots ? slots.split(',') : [], frequency, language, edition_push: editionPush }),
    [slots, frequency, language, editionPush],
  );

  const latest = useRef({ input, city });
  latest.current = { input, city };

  // Profile / city changes.
  useEffect(() => {
    syncEditionNotifications(input, city);
  }, [input, city]);

  // Foreground, and permission just granted (registerForPush).
  useEffect(() => {
    if (!IS_NATIVE) return;
    const run = () => syncEditionNotifications(latest.current.input, latest.current.city);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        run();
        uploadPushToken();
      }
    });
    resyncListeners.add(run);
    return () => {
      sub.remove();
      resyncListeners.delete(run);
    };
  }, []);

  // Push token for the signed-in user (also after a token rotation).
  const uid = session?.user.id;
  useEffect(() => {
    if (!IS_NATIVE || !uid) return;
    getNotificationPermission().then((p) => {
      if (p === 'granted') uploadPushToken();
    });
    const sub = Notifications.addPushTokenListener(() => uploadPushToken(true));
    return () => sub.remove();
  }, [uid]);

  // Tapping a notification opens the edition (a special push may name its edition).
  const response = useLastResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
    const editionId = typeof data.edition_id === 'string' ? data.edition_id : null;
    if (editionId) router.push({ pathname: '/edition/[id]', params: { id: editionId } });
    else router.navigate('/(tabs)');
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [response]);
}
