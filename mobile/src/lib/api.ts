// Typed wrappers for the Supabase RPCs and edge functions in docs/api-contract.md.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';
import { supabase } from './supabase';
import type {
  ArchiveEntry,
  City,
  Community,
  Feed,
  FeedItem,
  Me,
  PrefsPatch,
  Profile,
  Topic,
} from './types';

/** Error with the server's machine-readable code in `code` (e.g. 'archive_locked', 'invalid_code'). */
export class ApiError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args ?? {});
  if (error) throw new ApiError(error.message || error.code || 'rpc_error', error.message);
  return data as T;
}

export const api = {
  me: () => rpc<Me>('app_me'),
  personalEdition: (from: Date, to: Date) =>
    rpc<Feed>('app_personal_edition', { p_from: from.toISOString(), p_to: to.toISOString() }),
  editionView: (editionId: string) => rpc<Feed>('app_edition_view', { p_edition_id: editionId }),
  archive: (days = 30) => rpc<ArchiveEntry[]>('app_archive', { p_days: days }),
  search: (query: string, limit = 30) => rpc<FeedItem[]>('app_search', { p_query: query, p_limit: limit }),
  saved: () => rpc<FeedItem[]>('app_saved'),
  toggleSave: (itemId: string) => rpc<boolean>('app_toggle_save', { p_item_id: itemId }),
  markRead: (editionKey: string) => rpc<void>('app_mark_read', { p_edition_key: editionKey }),
  submitFeedback: (itemId: string, kind: 'helpful' | 'not_helpful' | 'error' | 'question', message?: string) =>
    rpc<string>('app_submit_feedback', { p_item_id: itemId, p_kind: kind, p_message: message ?? null }),
  updateProfile: (patch: PrefsPatch) => rpc<Profile>('app_update_profile', { p_patch: patch }),
  familyInvite: (phone: string, name: string) => rpc<unknown>('app_family_invite', { p_phone: phone, p_name: name }),
  familyRemove: (phone: string) => rpc<void>('app_family_remove', { p_phone: phone }),
  registerDevice: (token: string, platform: 'android' | 'ios') =>
    rpc<void>('app_register_device', { p_token: token, p_platform: platform }),
  recordDonation: (amount: number, frequency: 'once' | 'monthly') =>
    rpc<string>('app_record_donation', { p_amount: amount, p_frequency: frequency }),

  topics: async () => {
    const { data, error } = await supabase.from('app_topics').select('*').eq('active', true).order('sort');
    if (error) throw new ApiError(error.message);
    return data as Topic[];
  },
  communities: async () => {
    const { data, error } = await supabase.from('app_communities').select('*').eq('active', true).order('sort');
    if (error) throw new ApiError(error.message);
    return data as Community[];
  },
  cities: async () => {
    const { data, error } = await supabase.from('app_cities').select('*').eq('active', true).order('sort');
    if (error) throw new ApiError(error.message);
    return data as City[];
  },
  settings: async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value');
    if (error) throw new ApiError(error.message);
    return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])) as Record<
      string,
      unknown
    >;
  },
};

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok || json?.error) throw new ApiError(json?.error ?? `http_${res.status}`);
  return json as T;
}

export type AuthStartInput =
  | { mode: 'login'; phone: string }
  | { mode: 'register'; phone: string; full_name: string; email: string; birth_year?: number | null; city?: string | null };

export const auth = {
  /** Sends a 6-digit code to the email registered for this phone. */
  start: (input: AuthStartInput) => callFunction<{ ok: true; masked_email: string }>('app-auth-start', input),
  /** Verifies the code and signs the user in (sets the Supabase session). */
  verify: async (phone: string, code: string) => {
    const r = await callFunction<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user_id: string;
      is_new: boolean;
    }>('app-auth-verify', { phone, code });
    const { error } = await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
    if (error) throw new ApiError('session_error', error.message);
    return r;
  },
  signOut: () => supabase.auth.signOut(),
};
