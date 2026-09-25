import { Pause, Play } from 'lucide-react-native';
import { memo, useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { Icon, T } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import type { Audio } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space, touchMin } from '@/theme/tokens';
import { useAudioStore, type Track } from './store';

const S = defineStrings({
  he: {
    region: 'נגן המהדורה הקולית',
    play: 'השמעה',
    pause: 'השהיה',
    speed: (x: number) => `מהירות השמעה ${x}, לחצו לשינוי`,
    progress: 'התקדמות',
    of: (a: string, b: string) => `${a} מתוך ${b}`,
    artist: 'תמצית החדשות',
    back: 'אחורה 15 שניות',
    fwd: 'קדימה 15 שניות',
  },
  en: {
    region: 'Audio edition player',
    play: 'Play',
    pause: 'Pause',
    speed: (x: number) => `Playback speed ${x}, tap to change`,
    progress: 'Progress',
    of: (a: string, b: string) => `${a} of ${b}`,
    artist: 'Tamzit News',
    back: 'Back 15 seconds',
    fwd: 'Forward 15 seconds',
  },
  fr: {
    region: "Lecteur de l'édition audio",
    play: 'Lecture',
    pause: 'Pause',
    speed: (x: number) => `Vitesse de lecture ${x}, touchez pour changer`,
    progress: 'Progression',
    of: (a: string, b: string) => `${a} sur ${b}`,
    artist: 'Tamzit News',
    back: 'Reculer de 15 secondes',
    fwd: 'Avancer de 15 secondes',
  },
});

export function mmss(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Builds the player track for a feed's audio. */
export function useTrack(audio: Audio | null, title: string): Track | null {
  const s = useStrings(S);
  return useMemo(
    () => (audio ? { id: audio.id, url: audio.audio_url, title, duration: audio.duration_sec, artist: s.artist } : null),
    [audio, title, s.artist],
  );
}

/**
 * Design-system AudioPlayer: a navy bar with play/pause, title, progress (filling from the reading
 * start side), elapsed / total and a speed button (1× → 1.25× → 1.5× → 0.75×).
 * Shows `track` unless another track is already playing, in which case that one is shown.
 */
export const MiniPlayer = memo(function MiniPlayer({ track }: { track: Track }) {
  const { c } = useTheme();
  const s = useStrings(S);
  const current = useAudioStore((st) => st.track);
  const playing = useAudioStore((st) => st.playing);
  const other = !!current && current.id !== track.id && playing;
  const shown = other ? current! : track;
  const isCurrent = current?.id === shown.id;
  const buffering = useAudioStore((st) => isCurrent && st.buffering);
  const position = useAudioStore((st) => (isCurrent ? st.position : 0));
  const liveDuration = useAudioStore((st) => (isCurrent ? st.duration : 0));
  const rate = useAudioStore((st) => st.rate);
  const toggle = useAudioStore((st) => st.toggle);
  const cycleRate = useAudioStore((st) => st.cycleRate);
  const seekBy = useAudioStore((st) => st.seekBy);

  const on = isCurrent && playing;
  const duration = liveDuration > 0 ? liveDuration : shown.duration ?? 0;
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <View
      accessibilityLabel={s.region}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: 64,
        paddingVertical: space[2],
        paddingHorizontal: space[4],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceHero,
      }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={on ? s.pause : s.play}
        accessibilityState={{ busy: buffering }}
        onPress={() => toggle(shown)}
        hitSlop={4}
        style={({ pressed }) => ({
          width: touchMin,
          height: touchMin,
          borderRadius: touchMin / 2,
          backgroundColor: c.onHero,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}>
        {buffering ? (
          <ActivityIndicator color={c.surfaceHero} />
        ) : (
          <Icon as={on ? Pause : Play} size={20} color="surfaceHero" fill />
        )}
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="label" color="onHero" weight={700} numberOfLines={1} style={{ fontSize: 15, lineHeight: 20 }}>
          {shown.title}
        </T>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={s.progress}
          accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position), text: s.of(mmss(position), mmss(duration)) }}
          accessibilityActions={[
            { name: 'increment', label: s.fwd },
            { name: 'decrement', label: s.back },
          ]}
          onAccessibilityAction={(e) => {
            if (!isCurrent) return;
            seekBy(e.nativeEvent.actionName === 'increment' ? 15 : -15);
          }}
          style={{ height: 4, marginTop: 6, borderRadius: 2, backgroundColor: c.lineHero, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, width: `${pct}%`, borderRadius: 2, backgroundColor: c.sky }} />
        </View>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <T variant="caption" color="onHeroMuted" style={{ fontSize: 12, lineHeight: 16 }}>
            {mmss(position)}
          </T>
          <T variant="caption" color="onHeroMuted" style={{ fontSize: 12, lineHeight: 16 }}>
            {mmss(duration)}
          </T>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.speed(rate)}
        onPress={cycleRate}
        hitSlop={6}
        style={({ pressed }) => ({
          minWidth: 56,
          height: 40,
          paddingHorizontal: space[2],
          borderRadius: radius.pill,
          borderWidth: 1.5,
          borderColor: c.onHeroMuted,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}>
        <Text style={{ fontFamily: fonts[700], fontSize: 14, color: c.onHero, writingDirection: 'ltr' }}>{`${rate}×`}</Text>
      </Pressable>
    </View>
  );
});
