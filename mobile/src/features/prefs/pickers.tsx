// Shared preference pickers: used by the onboarding steps and by the settings screens.
// Each one renders only the control (no page title, no CTA) and is fully controlled.
import { Backpack, Check, Feather, Heart, List, MapPin, Newspaper, Plus, Smile } from 'lucide-react-native';
import { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button, Chip, Icon, LevelMeter, OptionCard, Segmented, T } from '@/components/ui';
import { EDITION_ICONS } from '@/features/edition/EditionHeader';
import { defineStrings, EDITION_NAMES, localName, slotEditionType, useLang, useStrings } from '@/lib/i18n';
import { useCommunities, useTopics } from '@/lib/queries';
import type { Audience, Community, EditionType, Language, LevelFilter, Style } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, touchMin } from '@/theme/tokens';

const S = defineStrings({
  he: {
    trackGeneral: 'כללי',
    trackGeneralDesc: 'המהדורה הרגילה, לכל הגילאים',
    trackYouth: 'נוער, גילאי \u206610–15\u2069',
    trackYouthDesc: 'ידיעות שנכתבו לבני נוער, בשפה ברורה ובלי פרטים קשים',
    topicsLoading: 'טוענים את הנושאים',
    topicsError: 'לא הצלחנו לטעון את הנושאים.',
    noTopics: 'אין כרגע נושאים לבחירה.',
    commLoading: 'טוענים את הקהילות',
    commError: 'לא הצלחנו לטעון את הקהילות.',
    noCommunities: 'עוד אין מהדורות קהילתיות. נעדכן כשיהיו.',
    retry: 'נסו שוב',
    add: 'הוספה',
    added: 'נוסף',
    addA11y: (n: string) => `הוספת ${n} למהדורה`,
    removeA11y: (n: string) => `הסרת ${n} מהמהדורה`,
    frequency: 'תדירות',
    once: 'פעם',
    onceHint: 'ערב',
    twice: 'פעמיים',
    twiceHint: 'בוקר וערב',
    three: '3 פעמים',
    threeHint: 'גם בצהריים',
    youGet: 'מה תקבלו',
    daily: 'המהדורה היומית, בערב',
    cholHamoed: 'בחול המועד אין מהדורת צהריים.',
    erevShabbat: 'בערב שבת וחג המהדורה האחרונה יוצאת בצהריים, ואחרי צאת השבת מגיעה מהדורת מוצאי שבת.',
    notifyNote: 'התראה מגיעה כשהמהדורה עולה.',
    levelCritical: 'רק קריטיות',
    levelCriticalDesc: 'מה שמשפיע עליכם ישירות, היום',
    levelImportant: 'קריטיות וחשובות',
    levelImportantDesc: 'מה שכדאי לדעת. מומלץ',
    levelGeneral: 'הכל',
    levelGeneralDesc: 'כולל ידיעות קלות ורקע',
    styleCalm: 'מרגיע',
    styleCalmDesc: 'שקט, בלי דרמה, עם הקשר מרגיע',
    styleCalmSample: '“גשם ראשון בדרך לצפון. אין צורך בהיערכות מיוחדת, רק מטרייה קרובה.”',
    styleHuman: 'אנושי',
    styleHumanDesc: 'האנשים שמאחורי הידיעה',
    styleHumanSample: '“בצפון מחכים לגשם הראשון, ובעיקר החקלאים: ‘זה בדיוק מה שהאדמה צריכה’.”',
    styleInfo: 'אינפורמטיבי',
    styleInfoDesc: 'עובדות, מספרים, תכל׳ס',
    styleInfoSample: '“תחזית: גשם ראשון ביום שישי בגליל ובגולן, וירידה בטמפרטורות.”',
    styleLight: 'קליל',
    styleLightDesc: 'בגובה העיניים, עם חיוך',
    styleLightSample: '“הוציאו את המטריות מהבוידעם: הגשם הראשון מגיע בשישי.”',
  },
  en: {
    trackGeneral: 'General',
    trackGeneralDesc: 'The regular edition, for all ages',
    trackYouth: 'Youth, ages 10–15',
    trackYouthDesc: 'News written for young readers, in clear language and without distressing details',
    topicsLoading: 'Loading topics',
    topicsError: "We couldn't load the topics.",
    noTopics: 'There are no topics to choose from right now.',
    commLoading: 'Loading communities',
    commError: "We couldn't load the communities.",
    noCommunities: "There are no community editions yet. We'll let you know when there are.",
    retry: 'Try again',
    add: 'Add',
    added: 'Added',
    addA11y: (n: string) => `Add ${n} to your edition`,
    removeA11y: (n: string) => `Remove ${n} from your edition`,
    frequency: 'How often',
    once: 'Once',
    onceHint: 'Evening',
    twice: 'Twice',
    twiceHint: 'Morning and evening',
    three: '3 times',
    threeHint: 'Also at midday',
    youGet: 'What you get',
    daily: 'The daily edition, in the evening',
    cholHamoed: 'On Chol Hamoed there is no midday edition.',
    erevShabbat: 'Before Shabbat and holidays the last edition comes out at midday, and the Motzei Shabbat edition arrives after Shabbat ends.',
    notifyNote: 'A notification comes when the edition is published.',
    levelCritical: 'Critical only',
    levelCriticalDesc: 'What affects you directly, today',
    levelImportant: 'Critical and important',
    levelImportantDesc: 'What is worth knowing. Recommended',
    levelGeneral: 'Everything',
    levelGeneralDesc: 'Including lighter news and background',
    styleCalm: 'Calm',
    styleCalmDesc: 'Quiet, no drama, with reassuring context',
    styleCalmSample: '“First rain on its way to the north. No special preparations needed, just keep an umbrella handy.”',
    styleHuman: 'Human',
    styleHumanDesc: 'The people behind the news',
    styleHumanSample: '“In the north, people are waiting for the first rain, farmers most of all: ‘It’s exactly what the land needs.’”',
    styleInfo: 'Informative',
    styleInfoDesc: 'Facts, numbers, to the point',
    styleInfoSample: '“Forecast: first rain on Friday in the Galilee and the Golan, with a drop in temperatures.”',
    styleLight: 'Light',
    styleLightDesc: 'Friendly, with a smile',
    styleLightSample: '“Dig out the umbrellas: the first rain arrives on Friday.”',
  },
  fr: {
    trackGeneral: 'Général',
    trackGeneralDesc: "L'édition habituelle, pour tous les âges",
    trackYouth: 'Jeunes, 10–15 ans',
    trackYouthDesc: 'Des nouvelles écrites pour les jeunes, dans un langage clair et sans détails pénibles',
    topicsLoading: 'Chargement des sujets',
    topicsError: "Nous n'avons pas pu charger les sujets.",
    noTopics: "Aucun sujet n'est disponible pour le moment.",
    commLoading: 'Chargement des communautés',
    commError: "Nous n'avons pas pu charger les communautés.",
    noCommunities: "Il n'y a pas encore d'éditions locales. Nous vous préviendrons.",
    retry: 'Réessayer',
    add: 'Ajouter',
    added: 'Ajoutée',
    addA11y: (n: string) => `Ajouter ${n} à votre édition`,
    removeA11y: (n: string) => `Retirer ${n} de votre édition`,
    frequency: 'Fréquence',
    once: '1 fois',
    onceHint: 'Le soir',
    twice: '2 fois',
    twiceHint: 'Matin et soir',
    three: '3 fois',
    threeHint: 'Aussi à midi',
    youGet: 'Ce que vous recevez',
    daily: 'L’édition quotidienne, le soir',
    cholHamoed: 'Pendant Hol Hamoed, il n’y a pas d’édition de midi.',
    erevShabbat: 'La veille de Chabbat et des fêtes, la dernière édition paraît à midi, et l’édition de Motsaé Chabbat arrive après la fin de Chabbat.',
    notifyNote: 'Une notification arrive quand l’édition est publiée.',
    levelCritical: 'Critiques seulement',
    levelCriticalDesc: 'Ce qui vous concerne directement, aujourd’hui',
    levelImportant: 'Critiques et importantes',
    levelImportantDesc: 'Ce qu’il vaut la peine de savoir. Recommandé',
    levelGeneral: 'Tout',
    levelGeneralDesc: 'Y compris les nouvelles légères et le contexte',
    styleCalm: 'Apaisant',
    styleCalmDesc: 'Calme, sans drame, avec un contexte rassurant',
    styleCalmSample: '« Premières pluies attendues dans le nord. Pas de préparatifs particuliers, gardez juste un parapluie à portée de main. »',
    styleHuman: 'Humain',
    styleHumanDesc: 'Les personnes derrière l’info',
    styleHumanSample: '« Dans le nord, on attend la première pluie, surtout les agriculteurs : “C’est exactement ce dont la terre a besoin.” »',
    styleInfo: 'Informatif',
    styleInfoDesc: 'Des faits, des chiffres, l’essentiel',
    styleInfoSample: '« Prévisions : premières pluies vendredi en Galilée et sur le Golan, avec une baisse des températures. »',
    styleLight: 'Léger',
    styleLightDesc: 'Simple et souriant',
    styleLightSample: '« Ressortez les parapluies : la première pluie arrive vendredi. »',
  },
});

const groupStyle = { gap: space[3] } as const;

// ---------------------------------------------------------------- Language

const LANGUAGES: { value: Language; title: string; description: string }[] = [
  { value: 'he', title: 'עברית', description: 'המהדורה בעברית' },
  { value: 'en', title: 'English', description: 'Your edition in English' },
  { value: 'fr', title: 'Français', description: 'Votre édition en français' },
];

/** עברית / English / Français. Each option is written in its own language. */
export function LanguagePicker({ value, onChange }: { value: Language; onChange: (v: Language) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={groupStyle}>
      {LANGUAGES.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          selected={value === o.value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Track (audience)

/** General edition, or the youth track (ages 10–15). */
export function TrackPicker({ value, onChange }: { value: Audience; onChange: (v: Audience) => void }) {
  const s = useStrings(S);
  return (
    <View accessibilityRole="radiogroup" style={groupStyle}>
      <OptionCard
        icon={Newspaper}
        title={s.trackGeneral}
        description={s.trackGeneralDesc}
        selected={value === 'general'}
        onPress={() => onChange('general')}
      />
      <OptionCard
        icon={Backpack}
        title={s.trackYouth}
        description={s.trackYouthDesc}
        selected={value === 'youth'}
        onPress={() => onChange('youth')}
      />
    </View>
  );
}

// ---------------------------------------------------------------- Topics

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const SKELETON_WIDTHS = [92, 70, 110, 84, 76, 120, 88, 64, 100];

function ChipSkeleton({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {SKELETON_WIDTHS.map((w, i) => (
        <View key={i} style={{ width: w, height: touchMin, borderRadius: radius.pill, backgroundColor: c.line, opacity: 0.6 }} />
      ))}
    </View>
  );
}

function LoadError({ message, onRetry, retry }: { message: string; onRetry: () => void; retry: string }) {
  return (
    <View style={{ gap: space[3], alignItems: 'flex-start' }}>
      <T variant="caption" color="inkMuted">{message}</T>
      <Button variant="secondary" onPress={onRetry}>{retry}</Button>
    </View>
  );
}

/** Topic chips (multi-select). Empty `value` means nothing selected here; callers decide defaults. */
export function TopicPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const s = useStrings(S);
  const lang = useLang();
  const q = useTopics();
  if (q.isPending) return <ChipSkeleton label={s.topicsLoading} />;
  if (q.isError) return <LoadError message={s.topicsError} retry={s.retry} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <T variant="caption" color="inkMuted">{s.noTopics}</T>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {q.data.map((t) => (
        <Chip key={t.id} label={localName(t, lang)} selected={value.includes(t.id)} onPress={() => onChange(toggle(value, t.id))} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Communities

function localDescription(row: Community, lang: Language) {
  return (lang === 'en' ? row.description_en : lang === 'fr' ? row.description_fr : row.description_he) || row.description_he || '';
}

const CommunityRow = memo(function CommunityRow({
  community,
  joined,
  onToggle,
}: {
  community: Community;
  joined: boolean;
  onToggle: (id: string) => void;
}) {
  const { c } = useTheme();
  const s = useStrings(S);
  const lang = useLang();
  const name = localName(community, lang);
  const description = localDescription(community, lang);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceRaised,
        borderWidth: 1,
        borderColor: joined ? c.brand : c.line,
      }}>
      <View style={{ width: touchMin, height: touchMin, borderRadius: touchMin / 2, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon as={MapPin} size={22} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="label" weight={700}>{name}</T>
        {description ? <T variant="caption" color="inkMuted">{description}</T> : null}
      </View>
      <Button
        variant={joined ? 'primary' : 'secondary'}
        icon={joined ? Check : Plus}
        onPress={() => onToggle(community.id)}
        accessibilityLabel={joined ? s.removeA11y(name) : s.addA11y(name)}
        style={{ paddingHorizontal: 14 }}>
        {joined ? s.added : s.add}
      </Button>
    </View>
  );
});

/** Community editions the reader can add (any number). */
export function CommunityPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const s = useStrings(S);
  const q = useCommunities();
  const onToggle = useCallback((id: string) => onChange(toggle(value, id)), [value, onChange]);
  if (q.isPending) {
    return (
      <View accessible accessibilityLabel={s.commLoading} style={{ paddingVertical: space[4] }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (q.isError) return <LoadError message={s.commError} retry={s.retry} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <T variant="caption" color="inkMuted">{s.noCommunities}</T>;
  return (
    <View style={{ gap: space[2] }}>
      {q.data.map((cm) => (
        <CommunityRow key={cm.id} community={cm} joined={value.includes(cm.id)} onToggle={onToggle} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Rhythm (frequency)

type Frequency = 1 | 2 | 3;

/** The editions a reader with `frequency` editions a day gets, in day order. */
export function frequencyEditions(frequency: Frequency): EditionType[] {
  return Array.from({ length: frequency }, (_, i) => slotEditionType(frequency, i));
}

/**
 * "What you get" for a frequency: one row per edition with its icon and name (no times: the
 * newsroom publishes on its own schedule, and a notification comes when the edition is out).
 */
export function FrequencyEditions({ frequency, title }: { frequency: Frequency; title: string }) {
  const { c } = useTheme();
  const s = useStrings(S);
  const lang = useLang();
  const rows = frequency === 1 ? [{ type: 'evening' as EditionType, name: s.daily }] : frequencyEditions(frequency).map((type) => ({ type, name: EDITION_NAMES[lang][type] }));
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${rows.map((r) => r.name).join(', ')}`}
      style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space[4], gap: space[3], borderWidth: 1, borderColor: c.line }}>
      <T variant="overline" color="inkMuted">{title}</T>
      {rows.map((r) => (
        <View key={r.type} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon as={EDITION_ICONS[r.type]} size={18} />
          </View>
          <T variant="label" style={{ flex: 1 }}>{r.name}</T>
        </View>
      ))}
    </View>
  );
}

/**
 * How many editions a day: once (the daily edition, in the evening), twice (morning and evening) or
 * three times (morning, midday and evening). The times are the newsroom's, not the reader's.
 */
export function RhythmPicker({ frequency, onChange }: { frequency: Frequency; onChange: (f: Frequency) => void }) {
  const s = useStrings(S);
  const options = useMemo(
    () => [
      { value: 1 as Frequency, label: s.once, hint: s.onceHint },
      { value: 2 as Frequency, label: s.twice, hint: s.twiceHint },
      { value: 3 as Frequency, label: s.three, hint: s.threeHint },
    ],
    [s],
  );
  return (
    <View style={{ gap: space[3] }}>
      <Segmented
        legend={s.frequency}
        options={options}
        value={frequency}
        onChange={(f) => {
          if (f !== frequency) onChange(f);
        }}
      />
      <FrequencyEditions frequency={frequency} title={s.youGet} />
      <View style={{ gap: space[1] }}>
        {frequency === 3 ? <T variant="caption" color="inkMuted">{s.cholHamoed}</T> : null}
        <T variant="caption" color="inkMuted">{s.erevShabbat}</T>
        <T variant="caption" color="inkMuted">{s.notifyNote}</T>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Level

function MeterMedia({ level }: { level: LevelFilter }) {
  return (
    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <LevelMeter level={level} />
    </View>
  );
}

/** Which items to include: critical only / critical and important (recommended) / everything. */
export function LevelPicker({ value, onChange }: { value: LevelFilter; onChange: (v: LevelFilter) => void }) {
  const s = useStrings(S);
  const options: { v: LevelFilter; title: string; description: string }[] = [
    { v: 'critical', title: s.levelCritical, description: s.levelCriticalDesc },
    { v: 'important', title: s.levelImportant, description: s.levelImportantDesc },
    { v: 'general', title: s.levelGeneral, description: s.levelGeneralDesc },
  ];
  return (
    <View accessibilityRole="radiogroup" style={{ gap: space[2] }}>
      {options.map((o) => (
        <OptionCard
          key={o.v}
          media={<MeterMedia level={o.v} />}
          title={o.title}
          description={o.description}
          selected={value === o.v}
          onPress={() => onChange(o.v)}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Style

/** Four writing voices; the selected card shows the same sample item in its voice. */
export function StylePicker({ value, onChange }: { value: Style; onChange: (v: Style) => void }) {
  const s = useStrings(S);
  const options: { v: Style; icon: typeof Feather; title: string; description: string; sample: string }[] = [
    { v: 'calm', icon: Feather, title: s.styleCalm, description: s.styleCalmDesc, sample: s.styleCalmSample },
    { v: 'human', icon: Heart, title: s.styleHuman, description: s.styleHumanDesc, sample: s.styleHumanSample },
    { v: 'informative', icon: List, title: s.styleInfo, description: s.styleInfoDesc, sample: s.styleInfoSample },
    { v: 'light', icon: Smile, title: s.styleLight, description: s.styleLightDesc, sample: s.styleLightSample },
  ];
  return (
    <View accessibilityRole="radiogroup" style={{ gap: space[3] }}>
      {options.map((o) => (
        <OptionCard
          key={o.v}
          icon={o.icon}
          title={o.title}
          description={o.description}
          sample={o.sample}
          selected={value === o.v}
          onPress={() => onChange(o.v)}
        />
      ))}
    </View>
  );
}
