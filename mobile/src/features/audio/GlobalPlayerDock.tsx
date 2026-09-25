import { router, usePathname, type Href } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { MiniPlayer } from './MiniPlayer';
import { useAudioStore, type Track } from './store';

const EDITION_TAB = '/';

/**
 * The audio player docked above the tab bar (mount it in the tabs layout, above the TabBar).
 * - On the edition tab: the current edition's audio (offered by the edition screen), or the track
 *   that is playing.
 * - On the other tabs: only while a track is loaded (started and not finished).
 * Renders nothing otherwise. Tapping the title opens the edition the audio belongs to.
 */
export function GlobalPlayerDock() {
  const { c } = useTheme();
  const track = useAudioStore((s) => s.track);
  const offered = useAudioStore((s) => s.offered);
  const pathname = usePathname();
  const onEditionTab = pathname === EDITION_TAB;
  const shown = onEditionTab ? offered ?? track : track;

  const open = useCallback(
    (t: Track) => {
      const href = t.href ?? EDITION_TAB;
      if (href === pathname) return;
      router.navigate(href as Href);
    },
    [pathname],
  );

  if (!shown) return null;
  return (
    <View style={{ paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2], backgroundColor: c.surface }}>
      <MiniPlayer track={shown} onPressTitle={onEditionTab ? undefined : open} />
    </View>
  );
}
