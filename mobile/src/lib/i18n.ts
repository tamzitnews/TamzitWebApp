// Minimal i18n: each module keeps its own strings and reads them with useStrings().
//
//   const S = defineStrings({
//     he: { title: 'מהדורת הבוקר', items: (n: number) => `${n} ידיעות` },
//     en: { title: 'Morning edition', items: (n: number) => `${n} items` },
//     fr: { title: 'Édition du matin', items: (n: number) => `${n} articles` },
//   });
//   const s = useStrings(S);  s.title; s.items(6)
//
// Hebrew is the source; English and French must have the same keys (TypeScript enforces it).
import { usePrefs } from '@/state/prefs';
import type { EditionType, Language, Level } from './types';

export function defineStrings<T extends Record<string, unknown>>(s: { he: T; en: T; fr: T }) {
  return s;
}

export function useLang(): Language {
  return usePrefs((s) => s.language);
}

export function useStrings<T>(s: { he: T; en: T; fr: T }): T {
  return s[useLang()];
}

export const isRTL = (lang: Language) => lang === 'he';

/** Name of a localized DB row: picks name_he / name_en / name_fr with Hebrew fallback. */
export function localName(row: { name_he: string; name_en?: string | null; name_fr?: string | null } | undefined, lang: Language) {
  if (!row) return '';
  return (lang === 'en' ? row.name_en : lang === 'fr' ? row.name_fr : row.name_he) || row.name_he;
}

export const EDITION_NAMES: Record<Language, Record<EditionType, string>> = {
  he: {
    morning: 'מהדורת הבוקר',
    noon: 'מהדורת הצהריים',
    evening: 'מהדורת הערב',
    erev_shabbat: 'מהדורת ערב שבת',
    motzash: 'מהדורת מוצאי שבת',
    special: 'עדכון מיוחד',
  },
  en: {
    morning: 'Morning edition',
    noon: 'Midday edition',
    evening: 'Evening edition',
    erev_shabbat: 'Erev Shabbat edition',
    motzash: 'Motzei Shabbat edition',
    special: 'Special update',
  },
  fr: {
    morning: 'Édition du matin',
    noon: 'Édition de midi',
    evening: 'Édition du soir',
    erev_shabbat: 'Édition de veille de Chabbat',
    motzash: 'Édition de Motsaé Chabbat',
    special: 'Mise à jour spéciale',
  },
};

export const LEVEL_NAMES: Record<Language, Record<Level, string>> = {
  he: { critical: 'קריטי', important: 'חשוב', general: 'כללי' },
  en: { critical: 'Critical', important: 'Important', general: 'General' },
  fr: { critical: 'Critique', important: 'Important', general: 'Général' },
};

const LOCALES: Record<Language, string> = { he: 'he-IL', en: 'en-GB', fr: 'fr-FR' };

/** "יום ה׳, 24 בספטמבר" / "Thursday, 24 September". */
export function formatDay(d: Date | string, lang: Language) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

/** "07:30". */
export function formatTime(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Edition name for the slot index of a reader with `frequency` editions a day. */
export function slotEditionType(frequency: 1 | 2 | 3, index: number): EditionType {
  if (frequency === 1) return 'evening';
  if (frequency === 2) return index === 0 ? 'morning' : 'evening';
  return (['morning', 'noon', 'evening'] as const)[index] ?? 'evening';
}
