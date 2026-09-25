// The two heading levels of the edition's news. The server sends the items already in reading
// order, grouped by section ("ביטחון", "מהמתרחש בארץ") and inside it by sub-heading
// ("החזית הדרומית"); EditionFeed inserts a heading row wherever the group changes.
import { memo } from 'react';
import { View } from 'react-native';

import { T } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/**
 * Level 1, the section: the title over an editorial rule (a short brand segment at the start edge,
 * a hairline to the end). `afterHeader` keeps the gap small right under the edition header.
 */
export const SectionHeading = memo(function SectionHeading({ title, afterHeader }: { title: string; afterHeader?: boolean }) {
  const { c } = useTheme();
  return (
    // The negative bottom margin eats into the next item's top padding, so the heading sits closer
    // to the group it opens than to the one before it.
    <View style={{ marginTop: afterHeader ? space[4] : space[8], marginBottom: -space[2] }}>
      <T variant="title" weight={700} accessibilityRole="header">
        {title}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: space[2] }}>
        <View style={{ width: 32, height: 3, backgroundColor: c.brand }} />
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      </View>
    </View>
  );
});

/**
 * Level 2, the sub-heading inside a section, in the brand tone. `afterSection` when it follows the
 * section heading directly (no items in between), so the two headings don't crowd each other.
 */
export const SubsectionHeading = memo(function SubsectionHeading({ title, afterSection }: { title: string; afterSection?: boolean }) {
  return (
    <T
      variant="label"
      weight={600}
      color="brand"
      accessibilityRole="header"
      style={{ marginTop: afterSection ? space[6] : space[4], marginBottom: -space[2] }}>
      {title}
    </T>
  );
});
