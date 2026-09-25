// The preference sub-screens of Settings. Each one reuses the shared picker from the onboarding,
// saves on change and says when the change takes effect.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import {
  CommunityPicker,
  LanguagePicker,
  LevelPicker,
  RhythmPicker,
  StylePicker,
  TopicPicker,
  TrackPicker,
} from '@/features/prefs/pickers';
import { api } from '@/lib/api';
import { useStrings } from '@/lib/i18n';
import { qk } from '@/lib/queries';
import { applyDirection } from '@/lib/rtl';
import type { Audience, Language, LevelFilter, Me, Style } from '@/lib/types';
import { usePrefs } from '@/state/prefs';
import { SaveFooter, SettingsPage } from './components';
import { useDebouncedSave, useEffectiveNote, useProfileValues, useSaveProfile, type SaveState } from './hooks';
import { SETTINGS_S } from './strings';

function useFooter(state: SaveState, slotTimes?: string[], frequency?: 1 | 2 | 3) {
  const { values } = useProfileValues();
  const note = useEffectiveNote(slotTimes ?? values.slot_times, frequency ?? values.frequency);
  return <SaveFooter note={note} state={state} />;
}

export function LanguageSettings() {
  const s = useStrings(SETTINGS_S);
  const { values, signedIn } = useProfileValues();
  const qc = useQueryClient();
  const setPrefs = usePrefs((x) => x.set);
  const [value, setValue] = useState<Language>(values.language);
  const [state, setState] = useState<SaveState>('idle');

  // The language is saved on the server first and only then applied locally: switching between
  // Hebrew and another language reloads the app, and the reload must not lose the change.
  const onChange = useCallback(
    async (lang: Language) => {
      if (lang === value) return;
      const prev = value;
      setValue(lang);
      setState('saving');
      try {
        if (signedIn) {
          const profile = await api.updateProfile({ language: lang });
          const me = qc.getQueryData<Me>(qk.me);
          if (me) qc.setQueryData<Me>(qk.me, { ...me, profile });
          qc.invalidateQueries({ queryKey: ['personal'] });
          qc.invalidateQueries({ queryKey: ['edition'] });
          qc.invalidateQueries({ queryKey: qk.archive });
        }
        setPrefs({ language: lang });
        setState('saved');
        await applyDirection(lang);
      } catch {
        setValue(prev);
        setState('error');
      }
    },
    [value, signedIn, qc, setPrefs],
  );

  const footer = useFooter(state);
  return (
    <SettingsPage title={s.language} note={s.languageNote} footer={footer}>
      <LanguagePicker value={value} onChange={onChange} />
    </SettingsPage>
  );
}

export function TrackSettings() {
  const s = useStrings(SETTINGS_S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const [value, setValue] = useState<Audience>(values.audience);
  const footer = useFooter(state);
  return (
    <SettingsPage title={s.track} note={s.trackNote} footer={footer}>
      <TrackPicker
        value={value}
        onChange={(v) => {
          setValue(v);
          save({ audience: v });
        }}
      />
    </SettingsPage>
  );
}

export function LevelSettings() {
  const s = useStrings(SETTINGS_S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const [value, setValue] = useState<LevelFilter>(values.level_filter);
  const footer = useFooter(state);
  return (
    <SettingsPage title={s.level} note={s.levelNote} footer={footer}>
      <LevelPicker
        value={value}
        onChange={(v) => {
          setValue(v);
          save({ level_filter: v });
        }}
      />
    </SettingsPage>
  );
}

export function StyleSettings() {
  const s = useStrings(SETTINGS_S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const [value, setValue] = useState<Style>(values.style);
  const footer = useFooter(state);
  return (
    <SettingsPage title={s.style} note={s.styleNote} footer={footer}>
      <StylePicker
        value={value}
        onChange={(v) => {
          setValue(v);
          save({ style: v });
        }}
      />
    </SettingsPage>
  );
}

export function TopicsSettings() {
  const s = useStrings(SETTINGS_S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const schedule = useDebouncedSave(save);
  const setPrefs = usePrefs((x) => x.set);
  const [value, setValue] = useState<string[]>(values.topics);
  const footer = useFooter(state);
  return (
    <SettingsPage title={s.topics} note={s.topicsNote} footer={footer}>
      <TopicPicker
        value={value}
        onChange={(v) => {
          setValue(v);
          setPrefs({ topicsTouched: true });
          schedule({ topics: v });
        }}
      />
    </SettingsPage>
  );
}

export function CommunitiesSettings() {
  const s = useStrings(SETTINGS_S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const schedule = useDebouncedSave(save);
  const [value, setValue] = useState<string[]>(values.communities);
  const footer = useFooter(state);
  return (
    <SettingsPage title={s.communities} subtitle={s.communitiesSub} footer={footer}>
      <CommunityPicker
        value={value}
        onChange={(v) => {
          setValue(v);
          schedule({ communities: v });
        }}
      />
    </SettingsPage>
  );
}

export function RhythmSettings() {
  const s = useStrings(SETTINGS_S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const schedule = useDebouncedSave(save, 900);
  const [value, setValue] = useState({ frequency: values.frequency, slotTimes: values.slot_times });
  const footer = useFooter(state, value.slotTimes, value.frequency);
  return (
    <SettingsPage title={s.rhythm} footer={footer}>
      <RhythmPicker
        frequency={value.frequency}
        slotTimes={value.slotTimes}
        onChange={(v) => {
          setValue(v);
          schedule({ frequency: v.frequency, slot_times: v.slotTimes });
        }}
      />
    </SettingsPage>
  );
}
