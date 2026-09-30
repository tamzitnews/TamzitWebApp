// Notices to readers found in the edition text ("קוראים יקרים, לרגל חול המועד יישלחו רק שתי
// מהדורות ביום…"): shown small under the edition header, clearly secondary to the news.
import { Info } from 'lucide-react-native';
import { memo } from 'react';
import { View } from 'react-native';

import { Icon, T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/** "קוראים יקרים," / "Dear readers," / "Chers lecteurs,": an opening line set in semibold. */
const GREETING = /^(קוראים יקרים|קוראות וקוראים יקרים|קוראים וקוראות יקרים|קוראות יקרות|dear readers|chers lecteurs|chères lectrices et chers lecteurs|chers lecteurs et chères lectrices)\s*[,:]?$/i;

function splitNotice(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const first = lines[0] ?? '';
  // Known greetings, or any short opening line that ends with a comma.
  const greeting = lines.length > 1 && (GREETING.test(first) || (first.length <= 32 && /[,،:]$/.test(first))) ? first : null;
  return { greeting, rest: (greeting ? lines.slice(1) : lines).join('\n'), label: lines.join(' ') };
}

const Notice = memo(function Notice({ text }: { text: string }) {
  const { c } = useTheme();
  const { greeting, rest, label } = splitNotice(text);
  if (!label) return null;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[2],
        paddingVertical: space[3],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.surface,
      }}>
      <View style={{ paddingTop: 2 }}>
        <Icon as={Info} size={16} color="inkMuted" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {greeting ? (
          <T variant="caption" color="inkMuted" weight={600} scaled>
            {greeting}
          </T>
        ) : null}
        {rest ? (
          <T variant="caption" color="inkMuted" weight={400} scaled>
            {rest}
          </T>
        ) : null}
      </View>
    </View>
  );
});

/** One or two notices, stacked, right under the edition header. */
export const NoticeStrip = memo(function NoticeStrip({ notices }: { notices: string[] }) {
  return (
    <View style={{ gap: space[2], marginTop: space[3] }}>
      {notices.map((n, i) => (
        <Notice key={`${i}:${n.length}`} text={n} />
      ))}
    </View>
  );
});
