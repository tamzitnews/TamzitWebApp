// Notifications are sent by the server: when an edition is published, every device whose reader gets
// that edition (by frequency and track) receives a push on the "editions" channel
// (data { type: 'edition', url }), and a special update arrives on the "special" channel
// (data { type: 'special', edition_id, url }). Nothing is sent during Shabbat or Yom Tov.
//
// The app only keeps the Android channels, asks for permission, registers the device push token (FCM)
// for the signed-in reader, and reacts to pushes: one that arrives while the app is open refreshes the
// edition at once, and a tap opens it (a special update opens its own edition page).
//
// Earlier builds scheduled local "edition is ready" notifications (ids "tz-edition:…", up to 7 days
// ahead); they are cancelled once per launch. Push registration fails gracefully when
// google-services.json is missing.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { usePrefs } from '@/state/prefs';
import { useSession } from '@/state/session';
import { api } from './api';
import { qk } from './queries';
import { supabase } from './supabase';
import type { Language } from './types';

const IS_NATIVE = Platform.OS === 'android' || Platform.OS === 'ios';

/** Android channel of the "new edition" pushes (the server sends them with this channel id). */
export const CHANNEL_EDITIONS = 'editions';
/** Android channel of the "special update" pushes (the server sends them with this channel id). */
export const CHANNEL_SPECIAL = 'special';

/** Identifier prefix of the local edition notifications that earlier builds scheduled. */
const LEGACY_ID_PREFIX = 'tz-edition:';

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

const TEXT: Record<Language, { channelEditions: string; channelEditionsDesc: string; channelSpecial: string; channelSpecialDesc: string }> = {
  he: {
    channelEditions: 'מהדורות',
    channelEditionsDesc: 'התראה כשמהדורה חדשה עולה',
    channelSpecial: 'עדכון מיוחד',
    channelSpecialDesc: 'רק באירוע חריג, מחוץ ללוח הזמנים',
  },
  en: {
    channelEditions: 'Editions',
    channelEditionsDesc: 'A notification when a new edition is published',
    channelSpecial: 'Special update',
    channelSpecialDesc: 'Only for an exceptional event, outside the schedule',
  },
  fr: {
    channelEditions: 'Éditions',
    channelEditionsDesc: 'Une notification quand une nouvelle édition est publiée',
    channelSpecial: 'Mise à jour spéciale',
    channelSpecialDesc: 'Seulement pour un événement exceptionnel, hors du programme',
  },
};

// ---------------------------------------------------------------- Legacy local notifications

let legacyCleanup: Promise<void> | null = null;

/** Cancels the local edition notifications that earlier builds scheduled. Runs once per launch. */
function cancelLegacyEditionNotifications() {
  if (!IS_NATIVE) return;
  legacyCleanup ??= (async () => {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        all
          .filter((n) => n.identifier.startsWith(LEGACY_ID_PREFIX))
          .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
      );
    } catch {
      legacyCleanup = null; // try again on the next mount
    }
  })();
}

cancelLegacyEditionNotifications();

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
let registering: string | null = null;

const tokenText = (t: Notifications.DevicePushToken) => (typeof t.data === 'string' ? t.data : JSON.stringify(t.data));

/**
 * Registers a push token for the signed-in reader, once per reader and token (`force`: again anyway).
 * Never asks the OS for the token itself: on Android getDevicePushTokenAsync() also fires the push-token
 * listener, so a listener that fetched the token again would loop.
 */
async function registerToken(token: string, force = false) {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return; // registered on the next sign-in by useNotificationSync
  const key = `${uid}:${token}`;
  if (registering === key || (!force && registeredFor === key)) return;
  registering = key;
  try {
    await api.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    registeredFor = key;
  } catch {
    // network / server error: retried on the next foreground
  } finally {
    registering = null;
  }
}

/** Gets the device push token and registers it for the signed-in user. Returns false if no token. */
async function uploadPushToken(force = false): Promise<boolean> {
  let token: string;
  try {
    token = tokenText(await withTimeout(Notifications.getDevicePushTokenAsync(), 10_000));
  } catch {
    // No Firebase config (google-services.json), Expo Go, emulator without Play services, …
    return false;
  }
  await registerToken(token, force);
  return true;
}

/**
 * Asks for permission (if not asked yet) and registers the push token with the server.
 * - 'granted': permission granted and the push token was obtained.
 * - 'denied': the reader said no (or turned notifications off in the system settings).
 * - 'unavailable': no push on this device/build (web, Expo Go, no Firebase config).
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
  return (await uploadPushToken(true)) ? 'granted' : 'unavailable';
}

/**
 * On sign-out: drops this device's push token, so the pushes of the reader who signed out stop
 * arriving here (the next sign-in registers a new token), and clears the notifications on screen.
 */
export async function forgetDeviceOnSignOut() {
  if (!IS_NATIVE) return;
  registeredFor = null;
  await Promise.all([
    withTimeout(Notifications.unregisterForNotificationsAsync(), 5_000).catch(() => {}),
    Notifications.dismissAllNotificationsAsync().catch(() => {}),
  ]);
}

// ---------------------------------------------------------------- Incoming pushes

type PushData = Record<string, unknown>;

function pushData(n: Notifications.Notification): PushData {
  return (n.request.content.data ?? {}) as PushData;
}

/** The edition a special-update push points to, if any. */
function pushEditionId(data: PushData): string | null {
  const id = data.edition_id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

/** A new edition or special update was published: fetch the personal edition (and archive) again. */
function refreshEditions(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['personal'] });
  qc.invalidateQueries({ queryKey: qk.archive });
}

// ---------------------------------------------------------------- Hook

// Only native builds deliver notification responses; on web the hook is a no-op.
const useLastResponse: () => Notifications.NotificationResponse | null | undefined = IS_NATIVE
  ? Notifications.useLastNotificationResponse
  : () => null;

/**
 * Registers the push token for the signed-in reader (again after a token rotation and on every
 * foreground until it succeeds), keeps the Android channel names in the reader's language, refreshes
 * the edition when a push arrives while the app is open, and opens it when a notification is tapped:
 * a special update opens its own edition, anything else the edition tab. Mount once, in the tabs layout.
 */
export function useNotificationSync() {
  const qc = useQueryClient();
  const { session } = useSession();
  const language = usePrefs((s) => s.language);

  useEffect(() => {
    cancelLegacyEditionNotifications();
  }, []);

  // Channel names follow the app language.
  useEffect(() => {
    if (IS_NATIVE) ensureChannels(language).catch(() => {});
  }, [language]);

  // Push token for the signed-in user (also after a token rotation), retried on every foreground.
  const uid = session?.user.id;
  useEffect(() => {
    if (!IS_NATIVE || !uid) return;
    const tryUpload = () =>
      getNotificationPermission().then((p) => {
        if (p === 'granted') uploadPushToken();
      });
    tryUpload();
    // A new token (rotation): register exactly that one. Fetching it again here would loop (see registerToken).
    const tokenSub = Notifications.addPushTokenListener((t) => registerToken(tokenText(t)));
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tryUpload();
    });
    return () => {
      tokenSub.remove();
      appSub.remove();
    };
  }, [uid]);

  // A push while the app is open: show the new edition right away.
  useEffect(() => {
    if (!IS_NATIVE) return;
    const sub = Notifications.addNotificationReceivedListener(() => refreshEditions(qc));
    return () => sub.remove();
  }, [qc]);

  // Tapping a notification: a special update opens its edition, a new edition opens the edition tab.
  const response = useLastResponse();
  useEffect(() => {
    if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    refreshEditions(qc);
    const editionId = pushEditionId(pushData(response.notification));
    if (editionId) router.push({ pathname: '/edition/[id]', params: { id: editionId } });
    else router.navigate('/(tabs)');
    Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }, [response, qc]);
}
