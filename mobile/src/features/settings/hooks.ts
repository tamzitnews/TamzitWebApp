import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useShabbatCity } from '@/features/shabbat/hooks';
import { formatTime, useLang } from '@/lib/i18n';
import { getNotificationPermission, nextEditionAt, type PermissionState } from '@/lib/notifications';
import { qk, useMe, useUpdateProfile } from '@/lib/queries';
import type { Language, Me, PrefsPatch, Profile } from '@/lib/types';
import { usePrefs, type PrefsState } from '@/state/prefs';
import { useSession } from '@/state/session';
import { SETTINGS_S } from './strings';

export type ProfileValues = Pick<
  Profile,
  | 'language'
  | 'audience'
  | 'topics'
  | 'communities'
  | 'frequency'
  | 'slot_times'
  | 'level_filter'
  | 'style'
  | 'theme'
  | 'text_scale'
  | 'shabbat_city_id'
  | 'special_push'
  | 'edition_push'
  | 'headline_in_push'
>;

/** Local prefs fields for a profile patch (same mapping as useUpdateProfile). */
export function patchToPrefs(patch: PrefsPatch): Partial<Omit<PrefsState, 'set' | 'reset'>> {
  const local: Partial<Omit<PrefsState, 'set' | 'reset'>> = {};
  if (patch.language) local.language = patch.language;
  if (patch.audience) local.audience = patch.audience;
  if (patch.topics) local.topics = patch.topics;
  if (patch.communities) local.communities = patch.communities;
  if (patch.frequency) local.frequency = patch.frequency;
  if (patch.slot_times) local.slotTimes = patch.slot_times;
  if (patch.level_filter) local.levelFilter = patch.level_filter;
  if (patch.style) local.style = patch.style;
  if (patch.theme) local.theme = patch.theme;
  if (patch.text_scale) local.textScale = patch.text_scale;
  if (patch.shabbat_city_id) local.shabbatCityId = patch.shabbat_city_id;
  return local;
}

/**
 * The reader's current preferences: the server profile when signed in, otherwise the local
 * onboarding preferences (switches that only exist on the server default to their DB defaults).
 */
export function useProfileValues() {
  const { session, loading } = useSession();
  const me = useMe(!!session);
  const p = usePrefs();
  const profile = me.data?.profile;
  const values: ProfileValues = useMemo(
    () =>
      profile ?? {
        language: p.language,
        audience: p.audience,
        topics: p.topics,
        communities: p.communities,
        frequency: p.frequency,
        slot_times: p.slotTimes,
        level_filter: p.levelFilter,
        style: p.style,
        theme: p.theme,
        text_scale: p.textScale,
        shabbat_city_id: p.shabbatCityId,
        special_push: true,
        edition_push: true,
        headline_in_push: false,
      },
    [profile, p],
  );
  return { values, me, signedIn: !!session, sessionLoading: loading };
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Saves profile fields: optimistic (the settings list and local prefs change at once), rolled back
 * if the server refuses. Before sign-in only the local prefs change.
 */
export function useSaveProfile() {
  const { session } = useSession();
  const qc = useQueryClient();
  const update = useUpdateProfile();
  const setPrefs = usePrefs((s) => s.set);
  const [state, setState] = useState<SaveState>('idle');
  const mutateAsync = update.mutateAsync;
  const signedIn = !!session;

  const save = useCallback(
    async (patch: PrefsPatch) => {
      if (!signedIn) {
        setPrefs(patchToPrefs(patch));
        setState('saved');
        return true;
      }
      const prev = qc.getQueryData<Me>(qk.me);
      if (prev?.profile) qc.setQueryData<Me>(qk.me, { ...prev, profile: { ...prev.profile, ...patch } });
      setState('saving');
      try {
        await mutateAsync(patch);
        setState('saved');
        return true;
      } catch {
        if (prev?.profile) {
          qc.setQueryData<Me>(qk.me, prev);
          setPrefs(patchToPrefs(prev.profile));
        }
        setState('error');
        return false;
      }
    },
    [signedIn, qc, mutateAsync, setPrefs],
  );
  return { save, state };
}

/**
 * Collects quick successive changes (multi-select, time steps) into one save after `delay` ms,
 * and flushes the pending change when the screen closes.
 */
export function useDebouncedSave(save: (patch: PrefsPatch) => Promise<boolean>, delay = 700) {
  const pending = useRef<PrefsPatch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = null;
    if (patch) saveRef.current(patch);
  }, []);

  const schedule = useCallback(
    (patch: PrefsPatch) => {
      pending.current = { ...(pending.current ?? {}), ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );

  useEffect(() => flush, [flush]);
  return schedule;
}

/** OS notification permission, refreshed when the app returns to the foreground. */
export function useNotificationPermission() {
  const [state, setState] = useState<PermissionState | null>(null);
  const refresh = useCallback(() => {
    getNotificationPermission().then(setState);
  }, []);
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return { permission: state, refresh };
}

const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };

/** "השינוי ייכנס לתוקף מהמהדורה הבאה, ב־20:00." for the given (or current) edition times. */
export function useEffectiveNote(slotTimes: string[], frequency: 1 | 2 | 3) {
  const lang = useLang();
  const s = SETTINGS_S[lang];
  const city = useShabbatCity();
  const key = slotTimes.join(',');
  return useMemo(() => {
    const next = nextEditionAt(key ? key.split(',') : [], frequency, city);
    if (!next) return null;
    const t = formatTime(next.at);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    let when: string;
    if (next.at.toDateString() === today.toDateString()) when = s.whenToday(t);
    else if (next.at.toDateString() === tomorrow.toDateString()) when = s.whenTomorrow(t);
    else when = s.whenDay(new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long' }).format(next.at), t);
    return s.effective(when);
  }, [key, frequency, city, s, lang]);
}

/** "+972501234567" → "050-123-4567". Other countries stay in international form. */
export function formatPhone(e164: string | null | undefined) {
  if (!e164) return '';
  const m = e164.replace(/[^\d+]/g, '');
  if (m.startsWith('+972')) {
    const local = `0${m.slice(4)}`;
    if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
    if (local.length === 9) return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
    return local;
  }
  return m;
}
