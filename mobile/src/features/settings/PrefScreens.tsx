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
import { SaveFooter, SettingsPage, ValuesGate } from './components';
import {
  useDebouncedSave,
  useEffectiveNote,
  useProfileValues,
  useSaveProfile,
  type ProfileValues,
  type SaveState,
} from './hooks';
import { SETTINGS_S } from './strings';

function Footer({ state, slotTimes, frequency }: { state: SaveState; slotTimes: string[]; frequency: 1 | 2 | 3 }) {
  const note = useEffectiveNote(slotTimes, frequency);
  return <SaveFooter note={note} state={state} />;
}

// ---------------------------------------------------------------- Language

function LanguageInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { signedIn } = useProfileValues();
  const qc = useQueryClient();
  const setPrefs = usePrefs((x) => x.set);
  const [value, setValue] = useState<Language>(initial.language);
  const [state, setState] = useState<SaveState>('idle');

  // The language is saved on the server first and only then applied locally: switching between
  // Hebrew and another language reloads the app, and the reload must not lose the change.
  const onChange = useCallback(
    async (lang: Language) => {
      if (lang === value || state === 'saving') return;
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
    [value, state, signedIn, qc, setPrefs],
  );

  return (
    <SettingsPage
      title={s.language}
      note={s.languageNote}
      footer={<Footer state={state} slotTimes={initial.slot_times} frequency={initial.frequency} />}>
      <LanguagePicker value={value} onChange={onChange} />
    </SettingsPage>
  );
}

export function LanguageSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.language}>{(v) => <LanguageInner initial={v} />}</ValuesGate>;
}

// ---------------------------------------------------------------- Single choice

function TrackInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { save, state } = useSaveProfile();
  const [value, setValue] = useState<Audience>(initial.audience);
  return (
    <SettingsPage title={s.track} note={s.trackNote} footer={<Footer state={state} slotTimes={initial.slot_times} frequency={initial.frequency} />}>
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

export function TrackSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.track}>{(v) => <TrackInner initial={v} />}</ValuesGate>;
}

function LevelInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { save, state } = useSaveProfile();
  const [value, setValue] = useState<LevelFilter>(initial.level_filter);
  return (
    <SettingsPage title={s.level} note={s.levelNote} footer={<Footer state={state} slotTimes={initial.slot_times} frequency={initial.frequency} />}>
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

export function LevelSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.level}>{(v) => <LevelInner initial={v} />}</ValuesGate>;
}

function StyleInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { save, state } = useSaveProfile();
  const [value, setValue] = useState<Style>(initial.style);
  return (
    <SettingsPage title={s.style} note={s.styleNote} footer={<Footer state={state} slotTimes={initial.slot_times} frequency={initial.frequency} />}>
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

export function StyleSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.style}>{(v) => <StyleInner initial={v} />}</ValuesGate>;
}

// ---------------------------------------------------------------- Multi choice (debounced)

function TopicsInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { save, state } = useSaveProfile();
  const schedule = useDebouncedSave(save);
  const setPrefs = usePrefs((x) => x.set);
  const [value, setValue] = useState<string[]>(initial.topics);
  return (
    <SettingsPage title={s.topics} note={s.topicsNote} footer={<Footer state={state} slotTimes={initial.slot_times} frequency={initial.frequency} />}>
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

export function TopicsSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.topics}>{(v) => <TopicsInner initial={v} />}</ValuesGate>;
}

function CommunitiesInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { save, state } = useSaveProfile();
  const schedule = useDebouncedSave(save);
  const [value, setValue] = useState<string[]>(initial.communities);
  return (
    <SettingsPage
      title={s.communities}
      subtitle={s.communitiesSub}
      footer={<Footer state={state} slotTimes={initial.slot_times} frequency={initial.frequency} />}>
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

export function CommunitiesSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.communities}>{(v) => <CommunitiesInner initial={v} />}</ValuesGate>;
}

function RhythmInner({ initial }: { initial: ProfileValues }) {
  const s = useStrings(SETTINGS_S);
  const { save, state } = useSaveProfile();
  const schedule = useDebouncedSave(save, 900);
  const [value, setValue] = useState({ frequency: initial.frequency, slotTimes: initial.slot_times });
  return (
    <SettingsPage title={s.rhythm} footer={<Footer state={state} slotTimes={value.slotTimes} frequency={value.frequency} />}>
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

export function RhythmSettings() {
  const s = useStrings(SETTINGS_S);
  return <ValuesGate title={s.rhythm}>{(v) => <RhythmInner initial={v} />}</ValuesGate>;
}
