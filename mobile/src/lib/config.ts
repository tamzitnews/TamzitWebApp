// App configuration from the public rows of app_settings (key → JSON value), each key validated on
// its own: a missing value, or one of the wrong type or out of range, falls back to its default.
// The server reads some of the same keys (free_archive_days, search_min_chars, family_max_members),
// so the defaults here match the server's.
import { useMemo } from 'react';

import { useAppSettings } from './queries';

export type AppConfig = {
  /** The association's donation page (https). */
  donation_url: string;
  support_email: string;
  /** The Tamzit website (https): About, the share texts and card, the family invitation. */
  website_url: string;
  privacy_url: string;
  /** Suggested amounts on the donation card, in shekels (1–6). */
  donation_amounts: readonly number[];
  /** Preselected amount; when it is not one of donation_amounts, the first amount is preselected. */
  donation_default_amount: number;
  donation_default_frequency: 'monthly' | 'once';
  /** Family plan members besides the owner (the plan has family_max_members + 1 people). */
  family_max_members: number;
  /** Ages of the youth track, shown as is (e.g. "10–15"). */
  youth_age_range: string;
  /** Free readers open editions of the last n days; older ones need Premium. */
  free_archive_days: number;
  /** Locked (older) editions shown to free readers under the open days of the archive. */
  archive_locked_teaser: number;
  search_min_chars: number;
  /** How often the open edition looks for a newer one (a push usually brings it at once). */
  edition_refresh_minutes: number;
  /** Wait before the verify screen offers to send a new code. */
  otp_resend_seconds: number;
};

export const APP_CONFIG_DEFAULTS: Readonly<AppConfig> = {
  donation_url: 'https://www.charidy.com/lokchimachrayut/tam',
  support_email: 'support@tamzit.org.il',
  website_url: 'https://tamzit.org.il',
  privacy_url: 'https://tamzit.org.il/privacy',
  donation_amounts: [18, 36, 100, 180],
  donation_default_amount: 36,
  donation_default_frequency: 'monthly',
  family_max_members: 4,
  youth_age_range: '10–15',
  free_archive_days: 7,
  archive_locked_teaser: 3,
  search_min_chars: 2,
  edition_refresh_minutes: 5,
  otp_resend_seconds: 60,
};

/** The largest amount the donation card accepts. */
const MAX_DONATION = 1_000_000;

/** An integer in [min, max]. Like the server's app_setting_int, a string of digits counts too. */
function int(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function httpsUrl(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(s) ? s : undefined;
}

function email(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined;
}

/** 1–6 distinct positive amounts, in the given order. */
function amounts(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const x of v) {
    const n = int(x, 1, MAX_DONATION);
    if (n === undefined) return undefined;
    if (!out.includes(n)) out.push(n);
  }
  return out.length >= 1 && out.length <= 6 ? out : undefined;
}

/** A short label such as "10–15". */
function shortText(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 20 ? s : undefined;
}

/** Validates the public app_settings (as returned by api.settings), key by key. Pure. */
export function parseAppConfig(settings: Record<string, unknown> | undefined): AppConfig {
  const v = settings ?? {};
  const d = APP_CONFIG_DEFAULTS;
  const frequency = v.donation_default_frequency;
  return {
    donation_url: httpsUrl(v.donation_url) ?? d.donation_url,
    support_email: email(v.support_email) ?? d.support_email,
    website_url: httpsUrl(v.website_url) ?? d.website_url,
    privacy_url: httpsUrl(v.privacy_url) ?? d.privacy_url,
    donation_amounts: amounts(v.donation_amounts) ?? d.donation_amounts,
    donation_default_amount: int(v.donation_default_amount, 1, MAX_DONATION) ?? d.donation_default_amount,
    donation_default_frequency: frequency === 'monthly' || frequency === 'once' ? frequency : d.donation_default_frequency,
    family_max_members: int(v.family_max_members, 1, 10) ?? d.family_max_members,
    youth_age_range: shortText(v.youth_age_range) ?? d.youth_age_range,
    free_archive_days: int(v.free_archive_days, 0, 3650) ?? d.free_archive_days,
    archive_locked_teaser: int(v.archive_locked_teaser, 0, 10) ?? d.archive_locked_teaser,
    search_min_chars: int(v.search_min_chars, 1, 10) ?? d.search_min_chars,
    edition_refresh_minutes: int(v.edition_refresh_minutes, 1, 60) ?? d.edition_refresh_minutes,
    otp_resend_seconds: int(v.otp_resend_seconds, 10, 600) ?? d.otp_resend_seconds,
  };
}

/** The app configuration: the defaults until app_settings loads (or when it fails), then the server's values. */
export function useAppConfig(): AppConfig {
  const { data } = useAppSettings();
  return useMemo(() => parseAppConfig(data), [data]);
}

/** "https://www.tamzit.org.il/privacy" → "tamzit.org.il", for display. */
export function urlHost(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : url;
}
