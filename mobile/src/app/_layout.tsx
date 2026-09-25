import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useRestPeriodsSync } from '@/features/shabbat/hooks';
import { useRestPeriodsHydrated } from '@/features/shabbat/store';
import { useAppFonts } from '@/lib/fonts';
import { queryClient } from '@/lib/queries';
import { isRTL } from '@/lib/i18n';
import { applyDirection } from '@/lib/rtl';
import { usePrefs } from '@/state/prefs';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});

function usePrefsHydrated() {
  const [done, setDone] = useState(usePrefs.persist.hasHydrated());
  useEffect(() => {
    const unsub = usePrefs.persist.onFinishHydration(() => setDone(true));
    setDone(usePrefs.persist.hasHydrated());
    return unsub;
  }, []);
  return done;
}

function RootStack() {
  const { c, scheme } = useTheme();
  useRestPeriodsSync();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface }, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="shabbat" options={{ animation: 'fade' }} />
        <Stack.Screen name="share/[itemId]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="feedback/[itemId]" options={{ presentation: 'transparentModal', animation: 'fade' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const fontsLoaded = useAppFonts();
  const hydrated = usePrefsHydrated();
  const restHydrated = useRestPeriodsHydrated();
  const language = usePrefs((s) => s.language);
  const [dirReady, setDirReady] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    applyDirection(language).then((reloading) => {
      if (!reloading) setDirReady(true);
    });
  }, [hydrated, language]);

  const ready = fontsLoaded && hydrated && restHydrated && dirReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            {Platform.OS === 'web' ? (
              // react-native-web takes the direction of logical styles (marginStart…) from a `dir` prop,
              // not from document.dir. Native uses I18nManager (applyDirection).
              <View style={{ flex: 1 }} {...({ dir: isRTL(language) ? 'rtl' : 'ltr' } as object)}>
                <RootStack />
              </View>
            ) : (
              <RootStack />
            )}
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
