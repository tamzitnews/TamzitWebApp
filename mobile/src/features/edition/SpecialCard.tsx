import { Bookmark, BookmarkCheck, MessageCircleQuestion, Siren, Share2 } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { Icon, IconButton, LevelMeter, T } from '@/components/ui';
import { defineStrings, formatTime, useStrings } from '@/lib/i18n';
import type { FeedItem } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { S } from './strings';

const A = defineStrings({
  he: { save: 'שמירה', saved: 'נשמר', share: 'שיתוף', feedback: 'משוב על הידיעה', updated: 'עודכן' },
  en: { save: 'Save', saved: 'Saved', share: 'Share', feedback: 'Feedback on this item', updated: 'Updated' },
  fr: { save: 'Enregistrer', saved: 'Enregistré', share: 'Partager', feedback: 'Avis sur cet article', updated: 'Mis à jour' },
});

/** "עדכון מיוחד": an item of a special edition, above the regular news, in the critical tone. */
export const SpecialCard = memo(function SpecialCard({
  item,
  onToggleSave,
  onShare,
  onFeedback,
}: {
  item: FeedItem;
  onToggleSave: (item: FeedItem) => void;
  onShare: (item: FeedItem) => void;
  onFeedback: (item: FeedItem) => void;
}) {
  const { c } = useTheme();
  const s = useStrings(S);
  const a = useStrings(A);
  return (
    <View
      style={{
        marginTop: space[4],
        padding: space[5],
        paddingBottom: space[3],
        borderRadius: radius.lg,
        backgroundColor: c.criticalSoft,
        borderStartWidth: 4,
        borderStartColor: c.critical,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], marginBottom: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 1 }}>
          <Icon as={Siren} size={18} color="criticalInk" strokeWidth={2} />
          <T variant="overline" color="criticalInk">
            {[s.special, item.topic_name, formatTime(item.published_at)].filter(Boolean).join(' · ')}
          </T>
        </View>
        <LevelMeter level={item.level} />
      </View>
      <T variant="headline" style={{ marginBottom: space[2] }} accessibilityRole="header">
        {item.headline}
      </T>
      <T variant="body" scaled selectable>
        {item.body}
      </T>
      {item.corrected_at ? (
        <T variant="caption" color="inkMuted" style={{ marginTop: space[2] }}>
          {a.updated} {formatTime(item.corrected_at)}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: space[2], marginStart: -10 }}>
        <IconButton
          icon={item.saved ? BookmarkCheck : Bookmark}
          label={item.saved ? a.saved : a.save}
          selected={item.saved}
          color={item.saved ? 'brand' : 'ink'}
          onPress={() => onToggleSave(item)}
        />
        <IconButton icon={Share2} label={a.share} color="ink" onPress={() => onShare(item)} />
        <IconButton icon={MessageCircleQuestion} label={a.feedback} color="ink" onPress={() => onFeedback(item)} />
      </View>
    </View>
  );
});
