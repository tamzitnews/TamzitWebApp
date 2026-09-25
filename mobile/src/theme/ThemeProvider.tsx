import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { usePrefs } from '@/state/prefs';
import { palette, type Colors } from './tokens';

type Theme = { scheme: 'light' | 'dark'; c: Colors; textScale: number };

const ThemeContext = createContext<Theme>({ scheme: 'light', c: palette.light, textScale: 1 });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const themePref = usePrefs((s) => s.theme);
  const textScale = usePrefs((s) => s.textScale);
  const scheme: 'light' | 'dark' =
    themePref === 'system' ? (system === 'dark' ? 'dark' : 'light') : themePref;
  const value = useMemo(() => ({ scheme, c: palette[scheme], textScale }), [scheme, textScale]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Current theme: `c` holds the color tokens (c.ink, c.surface, …). */
export function useTheme() {
  return useContext(ThemeContext);
}
