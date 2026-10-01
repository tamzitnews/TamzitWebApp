// A short welcome for a new reader, the first time the edition opens: four cards, each naming one thing worth
// knowing — the edition itself, the spoken edition, the archive, and that everything is adjustable. It appears once,
// can be left at any step, and is never shown again (the step is kept in the local preferences).
//
// Deliberately small: no pointing arrows at moving targets, no tour of every screen. A reader who skips it loses
// nothing — the app is the same with or without it.
import { Headphones, History, Newspaper, SlidersHorizontal, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, T } from '@/components/ui';
import { track } from '@/lib/analytics';
import { defineStrings, useStrings } from '@/lib/i18n';
import { usePrefs } from '@/state/prefs';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const S = defineStrings({
  he: {
    steps: [
      { title: 'המהדורה שלך', text: 'כל מה שחשוב, בכמה דקות. הידיעות מסודרות לפי נושא, והמהדורה נגמרת — אין גלילה אינסופית.' },
      { title: 'אפשר גם להאזין', text: 'בראש המהדורה יש כפתור האזנה: אותה מהדורה, מוקראת. אפשר להאזין גם עם מסך כבוי.' },
      { title: 'הארכיון', text: 'מהדורות קודמות ועדכונים מיוחדים נשמרים בלשונית "ארכיון", גם אחרי שקראתם אותם.' },
      { title: 'הכול מותאם אליכם', text: 'בהגדרות אפשר לבחור נושאים, כמה מהדורות ביום, ומתי לקבל התראות.' },
    ],
    next: 'הבא',
    done: 'מתחילים',
    skip: 'דילוג',
    of: (i: number, n: number) => `${i} מתוך ${n}`,
  },
  en: {
    steps: [
      { title: 'Your edition', text: 'What matters, in a few minutes. Items are grouped by subject, and the edition ends — no endless scroll.' },
      { title: 'You can listen', text: 'The Listen button at the top plays the same edition. It keeps playing with the screen off.' },
      { title: 'The archive', text: 'Earlier editions and special updates stay in the Archive tab, also after you read them.' },
      { title: 'Made to fit you', text: 'In Settings you choose subjects, how many editions a day, and when notifications arrive.' },
    ],
    next: 'Next',
    done: 'Start reading',
    skip: 'Skip',
    of: (i: number, n: number) => `${i} of ${n}`,
  },
  fr: {
    steps: [
      { title: 'Votre édition', text: "L'essentiel, en quelques minutes. Les articles sont groupés par sujet, et l'édition se termine." },
      { title: 'Vous pouvez écouter', text: "Le bouton Écouter lit la même édition, même écran éteint." },
      { title: 'Les archives', text: "Les éditions précédentes et les mises à jour spéciales restent dans l'onglet Archives." },
      { title: 'À votre mesure', text: 'Dans Réglages : les sujets, le nombre d’éditions par jour et les notifications.' },
    ],
    next: 'Suivant',
    done: 'Commencer',
    skip: 'Passer',
    of: (i: number, n: number) => `${i} sur ${n}`,
  },
});

const ICONS: LucideIcon[] = [Newspaper, Headphones, History, SlidersHorizontal];

/**
 * Shows the welcome once. `ready`: the edition behind it has content, so the reader sees what the cards talk about.
 */
export function Tour({ ready }: { ready: boolean }) {
  const s = useStrings(S);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const tourDone = usePrefs((p) => p.tourDone);
  const setPrefs = usePrefs((p) => p.set);
  const [step, setStep] = useState(0);

  const steps = s.steps;
  const visible = ready && !tourDone;
  if (!visible) return null;

  const finish = (how: 'done' | 'skip') => {
    track(how === 'done' ? 'tour_done' : 'tour_skip', { step: step + 1 });
    setPrefs({ tourDone: true });
  };
  const next = () => {
    if (step + 1 >= steps.length) {
      finish('done');
      return;
    }
    track('tour_step', { step: step + 2 });
    setStep(step + 1);
  };

  const Current = ICONS[step] ?? Newspaper;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => finish('skip')}>
      <View style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={s.skip} style={{ flex: 1 }} onPress={() => finish('skip')} />
        <View
          style={{
            backgroundColor: c.surfaceRaised,
            borderTopStartRadius: radius.lg,
            borderTopEndRadius: radius.lg,
            padding: space[5],
            paddingBottom: space[5] + insets.bottom,
            gap: space[4],
          }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: c.surfaceTint,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Icon as={Current} size={22} color="brand" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="caption" color="inkMuted">
                {s.of(step + 1, steps.length)}
              </T>
              <T variant="headline" weight={700}>
                {steps[step].title}
              </T>
            </View>
          </View>

          <T variant="body" color="inkMuted" scaled>
            {steps[step].text}
          </T>

          <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === step ? 18 : 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: i === step ? c.brand : c.line,
                }}
              />
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <Button onPress={next} style={{ flex: 1 }}>
              {step + 1 >= steps.length ? s.done : s.next}
            </Button>
            {step + 1 < steps.length ? (
              <Button variant="quiet" onPress={() => finish('skip')}>
                {s.skip}
              </Button>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
