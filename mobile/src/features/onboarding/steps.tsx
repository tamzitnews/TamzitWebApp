// The five onboarding steps: language → track → topics → rhythm → style.
// Values live in usePrefs; every step has a good default, so "continue" five times gives a
// reasonable edition.
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, T } from '@/components/ui';
import { CommunityPicker, LanguagePicker, LevelPicker, RhythmPicker, StylePicker, TopicPicker, TrackPicker } from '@/features/prefs/pickers';
import { api } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import { qk, useCommunities, useTopics } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import type { Language, Me } from '@/lib/types';
import { prefsToProfilePatch, usePrefs } from '@/state/prefs';
import { space } from '@/theme/tokens';
import { OnboardingFrame } from './layout';
import { STEP_HREF, STEPS, useOnboardingProgress, type StepId } from './progress';

const S = defineStrings({
  he: {
    next: 'המשך',
    finish: 'סיום',
    languageTitle: 'באיזו שפה תרצו לקרוא?',
    languageSub: 'המהדורות נכתבות בשלוש שפות. אפשר לשנות בכל עת.',
    trackTitle: 'למי המהדורה?',
    trackSub: 'במסלול הנוער הידיעות נכתבות במיוחד לגילאי 10–15. אפשר לשנות בכל עת.',
    topicsTitle: 'על מה תרצו להתעדכן?',
    topicsSub: 'בחרו כמה שתרצו. ידיעות קריטיות מגיעות תמיד, מכל נושא.',
    topicsNone: 'בחרו לפחות נושא אחד.',
    communityTitle: 'מהדורה קהילתית (לא חובה)',
    communitySub: 'ידיעות מקומיות, בסוף כל מהדורה.',
    rhythmTitle: 'מתי ומה לקבל?',
    rhythmSub: 'מהדורה קצרה בשעות קבועות. בלי התראות באמצע.',
    levelLegend: 'אילו ידיעות להציג?',
    styleTitle: 'באיזה סגנון לכתוב לכם?',
    styleSub: 'אותה ידיעה, ארבעה קולות.',
    saveError: 'לא הצלחנו לשמור את ההגדרות. בדקו את החיבור ונסו שוב.',
  },
  en: {
    next: 'Continue',
    finish: 'Done',
    languageTitle: 'Which language would you like to read in?',
    languageSub: 'Editions are written in three languages. You can change this at any time.',
    trackTitle: 'Who is the edition for?',
    trackSub: 'On the youth track, news is written especially for ages 10–15. You can change this at any time.',
    topicsTitle: 'What would you like to follow?',
    topicsSub: 'Choose as many as you like. Critical news always comes through, from any topic.',
    topicsNone: 'Choose at least one topic.',
    communityTitle: 'Community edition (optional)',
    communitySub: 'Local news at the end of every edition.',
    rhythmTitle: 'When, and what?',
    rhythmSub: 'A short edition at fixed times. No alerts in between.',
    levelLegend: 'Which news should we include?',
    styleTitle: 'Which writing style suits you?',
    styleSub: 'The same news, four voices.',
    saveError: "We couldn't save your settings. Check your connection and try again.",
  },
  fr: {
    next: 'Continuer',
    finish: 'Terminer',
    languageTitle: 'Dans quelle langue souhaitez-vous lire ?',
    languageSub: 'Les éditions sont rédigées en trois langues. Vous pourrez changer à tout moment.',
    trackTitle: 'À qui s’adresse l’édition ?',
    trackSub: 'Dans le parcours jeunes, les nouvelles sont écrites pour les 10–15 ans. Vous pourrez changer à tout moment.',
    topicsTitle: 'Quels sujets vous intéressent ?',
    topicsSub: 'Choisissez-en autant que vous voulez. Les nouvelles critiques arrivent toujours, quel que soit le sujet.',
    topicsNone: 'Choisissez au moins un sujet.',
    communityTitle: 'Édition locale (facultatif)',
    communitySub: 'Des nouvelles locales à la fin de chaque édition.',
    rhythmTitle: 'Quand, et quoi ?',
    rhythmSub: 'Une édition courte à heures fixes. Pas d’alertes entre deux.',
    levelLegend: 'Quelles nouvelles inclure ?',
    styleTitle: 'Quel style d’écriture vous convient ?',
    styleSub: 'La même nouvelle, quatre voix.',
    saveError: "Nous n'avons pas pu enregistrer vos réglages. Vérifiez votre connexion et réessayez.",
  },
});

/** Step position, persistence of the current step, and back/next navigation. */
function useStep(id: StepId) {
  const i = STEPS.indexOf(id);
  const setStep = useOnboardingProgress((s) => s.setStep);
  useFocusEffect(
    useCallback(() => {
      setStep(id);
    }, [id, setStep]),
  );
  const next = () => {
    const n = STEPS[i + 1];
    if (n) router.push(STEP_HREF[n]);
  };
  // The first step goes back to /welcome only when it is below us in the stack (a logged-in reader
  // sent here by the entry gate has nowhere to go back to).
  const back =
    i === 0
      ? router.canGoBack()
        ? () => {
            setStep(null);
            router.back();
          }
        : undefined
      : () => router.dismissTo(STEP_HREF[STEPS[i - 1]]);
  return { at: i + 1, of: STEPS.length, next, back };
}

// ---------------------------------------------------------------- 1. Language

export function LanguageStep() {
  const s = useStrings(S);
  const { at, of, next, back } = useStep('language');
  const language = usePrefs((p) => p.language);
  const setPrefs = usePrefs((p) => p.set);
  const [busy, setBusy] = useState(false);

  const choose = async (lang: Language) => {
    if (lang === language || busy) return;
    setBusy(true);
    useOnboardingProgress.getState().setStep('language');
    try {
      // A logged-in reader (profile not onboarded yet): save first, otherwise the entry gate would
      // copy the old language back from the profile after the reload.
      const { data } = await supabase.auth.getSession();
      if (data.session) await api.updateProfile({ language: lang }).catch(() => undefined);
    } finally {
      // The root layout applies the text direction on every language change (applyDirection); on
      // Android a direction flip reloads the app, and /welcome resumes here.
      setPrefs({ language: lang });
      setBusy(false);
    }
  };

  return (
    <OnboardingFrame
      at={at}
      of={of}
      onBack={back}
      title={s.languageTitle}
      subtitle={s.languageSub}
      cta={<Button block size="lg" onPress={next} disabled={busy}>{s.next}</Button>}>
      <LanguagePicker value={language} onChange={choose} />
    </OnboardingFrame>
  );
}

// ---------------------------------------------------------------- 2. Track

export function TrackStep() {
  const s = useStrings(S);
  const { at, of, next, back } = useStep('track');
  const audience = usePrefs((p) => p.audience);
  const setPrefs = usePrefs((p) => p.set);
  return (
    <OnboardingFrame at={at} of={of} onBack={back} title={s.trackTitle} subtitle={s.trackSub} cta={<Button block size="lg" onPress={next}>{s.next}</Button>}>
      <TrackPicker value={audience} onChange={(v) => setPrefs({ audience: v })} />
    </OnboardingFrame>
  );
}

// ---------------------------------------------------------------- 3. Topics (+ community)

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function TopicsStep() {
  const s = useStrings(S);
  const { at, of, next, back } = useStep('topics');
  const topics = usePrefs((p) => p.topics);
  const communities = usePrefs((p) => p.communities);
  const setPrefs = usePrefs((p) => p.set);
  const topicsQ = useTopics();
  const communitiesQ = useCommunities();

  // Until the reader edits the topics, the selection is the editors' default set.
  useEffect(() => {
    if (!topicsQ.data) return;
    const p = usePrefs.getState();
    if (p.topicsTouched) return;
    const defaults = topicsQ.data.filter((t) => t.is_default).map((t) => t.id);
    if (!sameSet(defaults, p.topics)) p.set({ topics: defaults });
  }, [topicsQ.data]);

  const none = !!topicsQ.data?.length && topics.length === 0;
  const showCommunities = !communitiesQ.isSuccess || communitiesQ.data.length > 0;

  return (
    <OnboardingFrame
      at={at}
      of={of}
      onBack={back}
      title={s.topicsTitle}
      subtitle={s.topicsSub}
      cta={
        <>
          {none ? <T variant="caption" color="criticalInk" align="center">{s.topicsNone}</T> : null}
          <Button block size="lg" onPress={next} disabled={none}>{s.next}</Button>
        </>
      }>
      <TopicPicker value={topics} onChange={(v) => setPrefs({ topics: v, topicsTouched: true })} />
      {showCommunities ? (
        <View style={{ gap: space[3], marginTop: space[3] }}>
          <View>
            <T variant="overline" color="inkMuted" accessibilityRole="header">{s.communityTitle}</T>
            <T variant="caption" color="inkMuted">{s.communitySub}</T>
          </View>
          <CommunityPicker value={communities} onChange={(v) => setPrefs({ communities: v })} />
        </View>
      ) : null}
    </OnboardingFrame>
  );
}

// ---------------------------------------------------------------- 4. Rhythm and level

export function RhythmStep() {
  const s = useStrings(S);
  const { at, of, next, back } = useStep('rhythm');
  const frequency = usePrefs((p) => p.frequency);
  const slotTimes = usePrefs((p) => p.slotTimes);
  const levelFilter = usePrefs((p) => p.levelFilter);
  const setPrefs = usePrefs((p) => p.set);
  return (
    <OnboardingFrame at={at} of={of} onBack={back} title={s.rhythmTitle} subtitle={s.rhythmSub} cta={<Button block size="lg" onPress={next}>{s.next}</Button>}>
      <RhythmPicker frequency={frequency} slotTimes={slotTimes} onChange={(v) => setPrefs({ frequency: v.frequency, slotTimes: v.slotTimes })} />
      <View style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600} accessibilityRole="header">{s.levelLegend}</T>
        <LevelPicker value={levelFilter} onChange={(v) => setPrefs({ levelFilter: v })} />
      </View>
    </OnboardingFrame>
  );
}

// ---------------------------------------------------------------- 5. Style, then finish

export function StyleStep() {
  const s = useStrings(S);
  const { at, of, back } = useStep('style');
  const style = usePrefs((p) => p.style);
  const setPrefs = usePrefs((p) => p.set);
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const finish = async () => {
    setError(false);
    setPrefs({ onboardingDone: true });
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      useOnboardingProgress.getState().setStep(null);
      router.push('/auth/register');
      return;
    }
    // Already signed in (the profile was not onboarded yet): save the choices to the account.
    setSaving(true);
    try {
      const profile = await api.updateProfile({ ...prefsToProfilePatch(usePrefs.getState()), onboarded: true });
      qc.setQueryData<Me>(qk.me, (old) => (old ? { ...old, profile } : old));
      qc.invalidateQueries({ queryKey: qk.me });
      useOnboardingProgress.getState().setStep(null);
      router.replace('/permissions');
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingFrame
      at={at}
      of={of}
      onBack={back}
      title={s.styleTitle}
      subtitle={s.styleSub}
      cta={
        <>
          {error ? <T variant="caption" color="criticalInk" align="center">{s.saveError}</T> : null}
          <Button block size="lg" onPress={finish} loading={saving}>{s.finish}</Button>
        </>
      }>
      <StylePicker value={style} onChange={(v) => setPrefs({ style: v })} />
    </OnboardingFrame>
  );
}
