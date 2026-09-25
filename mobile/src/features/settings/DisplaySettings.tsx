import { useState } from 'react';
import { View } from 'react-native';

import { LevelMeter, Segmented, T } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import type { ThemePref } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { SaveFooter, SettingsPage } from './components';
import { useProfileValues, useSaveProfile } from './hooks';

/** The three text sizes of the design system: 100%, 115%, 130%. */
export const TEXT_SCALES = [1, 1.15, 1.3] as const;

const S = defineStrings({
  he: {
    title: 'קריאה ותצוגה',
    theme: 'ערכת צבעים',
    system: 'מערכת',
    light: 'בהיר',
    dark: 'כהה',
    size: 'גודל טקסט',
    sizes: ['רגיל', 'גדול', 'גדול מאוד'],
    preview: 'תצוגה מקדימה',
    topic: 'מזג אוויר · 07:30',
    headline: 'גשם ראשון בדרך לצפון',
    body: 'אין צורך בהיערכות מיוחדת, רק מטרייה קרובה. מחר בצהריים הגשם צפוי להיחלש.',
    note: 'גודל הטקסט חל על הידיעות במהדורה, בארכיון ובשמורים.',
  },
  en: {
    title: 'Reading and display',
    theme: 'Theme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
    size: 'Text size',
    sizes: ['Normal', 'Large', 'Extra large'],
    preview: 'Preview',
    topic: 'Weather · 07:30',
    headline: 'First rain on its way to the north',
    body: 'No special preparations needed, just keep an umbrella close. The rain should ease by tomorrow afternoon.',
    note: 'Text size applies to the news in your edition, the archive and saved items.',
  },
  fr: {
    title: 'Lecture et affichage',
    theme: 'Thème',
    system: 'Système',
    light: 'Clair',
    dark: 'Sombre',
    size: 'Taille du texte',
    sizes: ['Normale', 'Grande', 'Très grande'],
    preview: 'Aperçu',
    topic: 'Météo · 07:30',
    headline: 'Premières pluies attendues dans le nord',
    body: 'Pas de préparatifs particuliers, gardez simplement un parapluie à portée de main. La pluie devrait faiblir demain après-midi.',
    note: 'La taille du texte s’applique aux informations de l’édition, aux archives et aux favoris.',
  },
});

function nearestScale(x: number) {
  return TEXT_SCALES.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), TEXT_SCALES[0]);
}

export function DisplaySettings() {
  const { c } = useTheme();
  const s = useStrings(S);
  const { values } = useProfileValues();
  const { save, state } = useSaveProfile();
  const [theme, setTheme] = useState<ThemePref>(values.theme);
  const [scale, setScale] = useState<number>(nearestScale(values.text_scale));

  return (
    <SettingsPage title={s.title} footer={<SaveFooter note={null} state={state} />}>
      <Segmented<ThemePref>
        legend={s.theme}
        value={theme}
        onChange={(v) => {
          setTheme(v);
          save({ theme: v });
        }}
        options={[
          { value: 'system', label: s.system },
          { value: 'light', label: s.light },
          { value: 'dark', label: s.dark },
        ]}
      />
      <Segmented<number>
        legend={s.size}
        value={scale}
        onChange={(v) => {
          setScale(v);
          save({ text_scale: v });
        }}
        options={TEXT_SCALES.map((v, i) => ({ value: v, label: s.sizes[i], hint: `${Math.round(v * 100)}%` }))}
      />
      <View style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.preview}
        </T>
        <View accessible accessibilityLabel={`${s.preview}: ${s.headline}. ${s.body}`} style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space[4], gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T variant="caption" color="inkMuted">
              {s.topic}
            </T>
            <LevelMeter level="important" />
          </View>
          <T variant="headline" scaled>
            {s.headline}
          </T>
          <T variant="body" scaled>
            {s.body}
          </T>
        </View>
        <T variant="caption" color="inkMuted">
          {s.note}
        </T>
      </View>
    </SettingsPage>
  );
}
