// Global audio player for the spoken edition. One expo-audio player lives for the whole app, so
// playback continues while the reader moves between screens, in the background and on the lock
// screen (expo-audio config plugin: background playback is on by default).
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { create } from 'zustand';

export type Track = {
  id: string;
  url: string;
  title: string;
  /** Seconds, from the server (the player reports the real value once loaded). */
  duration: number | null;
  /** Shown on the lock screen under the title. */
  artist: string;
  /** Screen the player's title leads back to (the edition this audio belongs to). */
  href?: string;
};

export const SPEEDS = [1, 1.25, 1.5, 0.75] as const;

type AudioState = {
  /** The loaded track (started at least once). */
  track: Track | null;
  /** The current edition's audio, offered by the edition tab before it is played. */
  offered: Track | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  rate: number;
  offer: (track: Track | null) => void;
  /** Starts `track` (loading it if it is not the current one) or resumes it. */
  play: (track: Track) => Promise<void>;
  pause: () => void;
  toggle: (track: Track) => void;
  cycleRate: () => void;
  seekBy: (seconds: number) => void;
  stop: () => void;
};

let player: AudioPlayer | null = null;
let modeReady: Promise<void> | null = null;

function ensureMode() {
  if (!modeReady) {
    modeReady = setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }
  return modeReady;
}

// What the reader asked for. The player reports `playing: false` while it loads or buffers, so the
// UI keeps showing "playing" (with a spinner) until the audio actually starts or is paused elsewhere
// (lock screen, headphones, another app taking audio focus).
let intent = false;
let intentAt = 0;

function onStatus(st: AudioStatus) {
  const cur = useAudioStore.getState();
  if (st.didJustFinish) {
    // Done: unload, so the dock leaves the other tabs (the edition tab still offers the audio).
    useAudioStore.getState().stop();
    player?.seekTo(0).catch(() => {});
    return;
  }
  const grace = Date.now() - intentAt < 1500;
  if (st.playing) intent = true;
  else if (intent && st.isLoaded && !st.isBuffering && !grace) intent = false;
  const playing = st.playing || intent;
  const buffering = intent && !st.playing;
  const duration = st.duration > 0 ? st.duration : cur.duration;
  const position = Math.min(st.currentTime || 0, duration || Infinity);
  if (
    cur.playing !== playing ||
    cur.buffering !== buffering ||
    Math.abs(cur.position - position) >= 0.25 ||
    cur.duration !== duration
  ) {
    useAudioStore.setState({ playing, buffering, position, duration });
  }
}

function ensurePlayer() {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', onStatus);
  }
  return player;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  track: null,
  offered: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  rate: 1,

  offer: (track) => {
    const cur = get().offered;
    if (cur?.id === track?.id && cur?.title === track?.title && cur?.url === track?.url) return;
    set({ offered: track });
  },

  play: async (track) => {
    await ensureMode();
    const p = ensurePlayer();
    if (get().track?.id !== track.id) {
      p.replace({ uri: track.url });
      set({ track, position: 0, duration: track.duration ?? 0, buffering: true });
      try {
        // Required on Android for sustained background playback; also shows lock-screen controls.
        p.setActiveForLockScreen(true, { title: track.title, artist: track.artist }, { showSeekBackward: true, showSeekForward: true });
      } catch {
        // not supported on this platform
      }
    }
    intent = true;
    intentAt = Date.now();
    p.play();
    p.setPlaybackRate(get().rate);
    set({ playing: true, buffering: !p.playing });
  },

  pause: () => {
    intent = false;
    player?.pause();
    set({ playing: false, buffering: false });
  },

  toggle: (track) => {
    const st = get();
    if (st.track?.id === track.id && st.playing) st.pause();
    else st.play(track).catch(() => set({ playing: false, buffering: false }));
  },

  cycleRate: () => {
    const i = SPEEDS.indexOf(get().rate as (typeof SPEEDS)[number]);
    const rate = SPEEDS[(i + 1) % SPEEDS.length];
    player?.setPlaybackRate(rate);
    set({ rate });
  },

  seekBy: (seconds) => {
    const { position, duration } = get();
    const to = Math.max(0, Math.min(position + seconds, duration || position + seconds));
    player?.seekTo(to).catch(() => {});
    set({ position: to });
  },

  stop: () => {
    intent = false;
    if (player) {
      player.pause();
      try {
        player.clearLockScreenControls();
      } catch {
        // ignore
      }
    }
    set({ track: null, playing: false, buffering: false, position: 0, duration: 0 });
  },
}));
