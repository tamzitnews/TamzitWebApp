// Notifications. STUB — the settings agent implements local edition reminders (skipping Shabbat)
// and push token registration.
import type { City, Profile } from './types';

/** Re-schedules the local "edition is ready" notifications for the next days. Safe to call often. */
export async function syncEditionNotifications(_profile: Profile, _city?: City): Promise<void> {}

/** Asks for permission (if not asked yet) and registers the push token with the server. */
export async function registerForPush(): Promise<'granted' | 'denied' | 'unavailable'> {
  return 'unavailable';
}
