import { Flame, Headphones, Megaphone, Moon, Sun, Sunrise, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { ForwardChevron, Icon, T } from '@/components/ui';
import { EDITION_NAMES, formatTime, useLang, useStrings } from '@/lib/i18n';
import type { ArchiveEntry, EditionType } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { shortDate } from './dates';
import { LockPill } from './LockPill';
import { ArchiveStrings } from './strings';

export const PERIOD_ICONS: Record<EditionType, LucideIcon> = {
  morning: Sunrise,
  noon: Sun,
  evening: Moon,
  erev_shabbat: Flame,
  motzash: Flame,
  special: Megaphone,
};

/**
 * One edition in the archive (design-system EditionRow): period icon, name, "07:30 · 6 ידיעות",
 * headphones when there is audio, an unread dot, and a chevron. A locked row (older than the free
 * window) shows the "פרימיום" pill instead and is dimmed. `withDate` puts the date in the meta line
 * (for rows outside a per-day section).
 */
export const EditionRow = memo(function EditionRow({
  entry,
  withDate,
  onPress,
}: {
  entry: ArchiveEntry;
  withDate?: boolean;
  onPress: (entry: ArchiveEntry) => void;
}) {
  const { c } = useTheme();
  const lang = useLang();
  const s = useStrings(ArchiveStrings);
  const name = entry.title?.trim() || EDITION_NAMES[lang][entry.edition_type];
  const date = new Date(entry.published_at);
  const meta = withDate
    ? `${shortDate(date, lang, new Date())} · ${formatTime(date)}`
    : `${formatTime(date)} · ${s.items(entry.item_count)}`;
  const unread = !entry.read && !entry.locked;
  const a11y = [name, meta, entry.has_audio ? s.hasAudio : null, unread ? s.unread : null, entry.locked ? s.premium : null]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={entry.locked ? s.lockedHint : undefined}
      onPress={() => onPress(entry)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: 72,
        paddingVertical: space[3],
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        opacity: pressed ? 0.7 : 1,
      })}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3], opacity: entry.locked ? 0.6 : 1 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.md,
            backgroundColor: c.surfaceTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon as={PERIOD_ICONS[entry.edition_type] ?? Sun} size={22} color="ink" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="label" weight={700} numberOfLines={2}>
            {name}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T variant="caption" color="inkMuted" style={{ flexShrink: 1 }}>
              {meta}
            </T>
            {entry.has_audio ? <Icon as={Headphones} size={15} color="inkMuted" /> : null}
          </View>
        </View>
      </View>
      {entry.locked ? (
        <LockPill />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          {unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand }} /> : null}
          <ForwardChevron />
        </View>
      )}
    </Pressable>
  );
});
