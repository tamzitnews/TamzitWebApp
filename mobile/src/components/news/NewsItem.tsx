import { Bookmark, BookmarkCheck, MessageCircleQuestion, Share2 } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { IconButton, LevelMeter, T } from '@/components/ui';
import { defineStrings, formatTime, localName, useLang, useStrings } from '@/lib/i18n';
import { useTopics } from '@/lib/queries';
import type { FeedItem, Level } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

const S = defineStrings({
  he: { save: 'שמירה', saved: 'נשמר', share: 'שיתוף', feedback: 'משוב על הידיעה', updated: 'עודכן' },
  en: { save: 'Save', saved: 'Saved', share: 'Share', feedback: 'Feedback on this item', updated: 'Updated' },
  fr: { save: 'Enregistrer', saved: 'Enregistré', share: 'Partager', feedback: 'Avis sur cet article', updated: 'Mis à jour' },
});

const JEV = defineStrings({
  he: { levels: { critical: 'קריטי', important: 'חשוב', general: 'כללי' } as Record<Level, string>, certainty: 'ודאות', noTopic: 'בלי נושא' },
  en: { levels: { critical: 'critical', important: 'important', general: 'general' } as Record<Level, string>, certainty: 'certainty', noTopic: 'no topic' },
  fr: { levels: { critical: 'critique', important: 'important', general: 'général' } as Record<Level, string>, certainty: 'certitude', noTopic: 'sans sujet' },
});

/**
 * Pilot only: what the Jev classifier said about the item ("Jev · ביטחון, עולם · חשוב · ודאות 85%"), when the server
 * sends it (app_settings.jev_show_labels). Display only: the level meter above shows the level actually applied.
 */
function JevLine({ ai }: { ai: NonNullable<FeedItem['ai']> }) {
  const s = useStrings(JEV);
  const lang = useLang();
  const topics = useTopics();
  const nameOf = (id: string) => localName(topics.data?.find((t) => t.id === id), lang) || id;
  const parts = [
    'Jev',
    ai.topics.length ? ai.topics.map(nameOf).join(', ') : s.noTopic,
    ai.importance ? s.levels[ai.importance] : null,
    ai.confidence != null ? `${s.certainty} ${Math.round(ai.confidence * 100)}%` : null,
  ];
  return (
    <T variant="caption" color="inkMuted" style={{ marginTop: space[2] }}>
      {parts.filter(Boolean).join(' · ')}
    </T>
  );
}

/**
 * One news item (design-system NewsItem): topic · time, level meter, headline, body, and the three
 * actions. Presentational: pass handlers (see features/items/actions.ts → useItemActions()).
 * Under a section heading of the edition pass `showTopic={false}`: the heading already names it.
 */
export const NewsItem = memo(function NewsItem({
  item,
  onToggleSave,
  onShare,
  onFeedback,
  showTime = true,
  showTopic = true,
  timeLabel,
  last,
}: {
  item: FeedItem;
  onToggleSave?: (item: FeedItem) => void;
  onShare?: (item: FeedItem) => void;
  onFeedback?: (item: FeedItem) => void;
  showTime?: boolean;
  /** Show the topic in the "topic · time" line (false under a section heading that already names it). */
  showTopic?: boolean;
  /** Replaces the time in the "topic · time" line (e.g. "היום", "אתמול", a date). */
  timeLabel?: string;
  last?: boolean;
}) {
  const { c } = useTheme();
  const s = useStrings(S);
  const topic = !showTopic ? null : item.kind === 'community' ? item.community_name ?? item.topic_name : item.topic_name;
  return (
    <View style={{ paddingVertical: space[6], borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {[topic, timeLabel ?? (showTime ? formatTime(item.published_at) : null)].filter(Boolean).join(' · ')}
        </T>
        <LevelMeter level={item.level} showLabel={item.level === 'critical'} />
      </View>
      {item.headline ? (
        <T variant="headline" style={{ marginBottom: space[2] }} accessibilityRole="header">
          {item.headline}
        </T>
      ) : null}
      <T variant="body" scaled selectable>
        {item.body}
      </T>
      {item.ai ? <JevLine ai={item.ai} /> : null}
      {item.corrected_at ? (
        <T variant="caption" color="inkMuted" style={{ marginTop: space[2] }}>
          {s.updated} {formatTime(item.corrected_at)}
        </T>
      ) : null}
      {onToggleSave || onShare || onFeedback ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: space[3], marginStart: -10 }}>
          {onToggleSave ? (
            <IconButton
              icon={item.saved ? BookmarkCheck : Bookmark}
              label={item.saved ? s.saved : s.save}
              selected={item.saved}
              onPress={() => onToggleSave(item)}
            />
          ) : null}
          {onShare ? <IconButton icon={Share2} label={s.share} onPress={() => onShare(item)} /> : null}
          {onFeedback ? <IconButton icon={MessageCircleQuestion} label={s.feedback} onPress={() => onFeedback(item)} /> : null}
        </View>
      ) : null}
    </View>
  );
});
