// TEMPORARY dev-only route for visual testing of the edition renderer. Delete before commit.
import { useLocalSearchParams } from 'expo-router';

import { AppBar, Screen } from '@/components/ui';
import { EditionFeed } from '@/features/edition/EditionFeed';
import { OfflineBanner } from '@/features/edition/Closing';
import type { Feed, FeedItem } from '@/lib/types';
import { usePrefs } from '@/state/prefs';
import { useEffect } from 'react';

const base = { topic_id: 't', community_id: null, community_name: null, style: 'calm', corrected_at: null, saved: false, kind: 'news' as const };
const it = (id: string, p: Partial<FeedItem>): FeedItem => ({ ...base, id, topic_name: 'מזג אוויר', level: 'important', headline: '', body: '', published_at: '2026-09-25T04:10:00Z', ...p });

const feed: Feed = {
  window: { from: '2026-09-24T17:00:00Z', to: '2026-09-25T04:30:00Z' },
  edition_types: ['morning'],
  title: null,
  special: [it('s1', { topic_name: 'ביטחון', level: 'critical', headline: 'הנחיות פיקוד העורף עודכנו באזור הצפון', body: 'ההתקהלויות מוגבלות עד 300 איש בשטח פתוח. מוסדות החינוך פועלים כרגיל. אין צורך בהיערכות מיוחדת מעבר להנחיות.' })],
  items: [
    it('a1', { topic_name: 'מים', level: 'critical', headline: 'שיבוש באספקת המים בדרום ירושלים עד הערב', body: 'בעקבות תקלה בצנרת ראשית צפוי לחץ מים נמוך בכמה שכונות עד 18:00. תאגיד המים מציב נקודות חלוקה.' }),
    it('a2', { saved: true, headline: 'גשם ראשון צפוי בסוף השבוע בצפון', body: 'התחזית צופה ירידה בטמפרטורות וממטרים מקומיים, בעיקר בגליל ובגולן. במרכז ובדרום יישאר נאה.', corrected_at: '2026-09-25T05:20:00Z' }),
    it('a3', { topic_name: 'תחבורה', level: 'general', headline: 'עבודות לילה בנתיבי איילון השבוע', body: 'הנתיבים צפונה ייסגרו חלקית בלילות, בין 23:00 ל־05:00. מומלץ לתכנן נסיעה מוקדמת.' }),
    it('a4', { topic_name: 'חינוך', level: 'general', headline: 'נפתח הרישום לתוכניות הקיץ בבתי הספר', body: 'ההרשמה נעשית דרך אתר הרשות המקומית. מספר המקומות בכל תוכנית מוגבל.' }),
  ],
  community: [it('c1', { kind: 'community', community_id: 'jerusalem', community_name: 'ירושלים', level: 'general', headline: 'שינוי בתדירות הקו האדום ברכבת הקלה', body: 'בשבוע הבא הרכבות יגיעו כל 8 דקות בשעות הערב, בגלל עבודות תחזוקה.' })],
  good_news: it('g1', { kind: 'good_news', level: 'general', headline: 'תלמידי תיכון בנו מערכת השקיה לגינה הקהילתית', body: 'הפרויקט התחיל כעבודת גמר, והיום הוא משקה את כל ערוגות השכונה.' }),
  ad: { id: 'ad1', sponsor: 'ספריית העיר', body: 'שבוע הספר בספרייה העירונית: הרצאות וסדנאות לכל המשפחה, בכניסה חופשית.', link_url: 'https://example.org' },
  audio: { id: 'au1', kind: 'edition', title: 'מהדורת הבוקר', audio_url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3', duration_sec: 252, published_at: '2026-09-25T04:30:00Z' },
  minutes: 4,
  is_premium: false,
};

export default function DevEdition() {
  const { empty, theme, offline } = useLocalSearchParams<{ empty?: string; theme?: string; offline?: string }>();
  const set = usePrefs((s) => s.set);
  useEffect(() => {
    if (theme === 'dark' || theme === 'light') set({ theme });
  }, [theme, set]);
  const f = empty ? { ...feed, items: [], special: [], ad: null } : feed;
  if (empty) set({ levelFilter: 'critical' });
  return (
    <Screen header={<AppBar title="תמצית החדשות" />}>
      <EditionFeed feed={f} type="morning" name="מהדורת הבוקר" readKey="dev:test" banner={offline ? <OfflineBanner /> : null} />
    </Screen>
  );
}
