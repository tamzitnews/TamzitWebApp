import { Tabs } from 'expo-router';
import { Bookmark, History, Newspaper, Settings, type LucideIcon } from 'lucide-react-native';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, T } from '@/components/ui';
import { GlobalPlayerDock } from '@/features/audio';
import { useNotificationSync } from '@/lib/notifications';
import { defineStrings, useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';

const S = defineStrings({
  he: { index: 'המהדורה', archive: 'ארכיון', saved: 'שמורים', settings: 'הגדרות', nav: 'ניווט ראשי' },
  en: { index: 'Edition', archive: 'Archive', saved: 'Saved', settings: 'Settings', nav: 'Main navigation' },
  fr: { index: 'Édition', archive: 'Archives', saved: 'Enregistrés', settings: 'Réglages', nav: 'Navigation principale' },
});

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, LucideIcon> = { index: Newspaper, archive: History, saved: Bookmark, settings: Settings };

/** The design-system TabBar: four fixed tabs, active in brand with a sky bar above it, no badges. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c } = useTheme();
  const s = useStrings(S);
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={s.nav}
      style={{
        flexDirection: 'row',
        height: 64 + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: c.surfaceRaised,
        borderTopWidth: 1,
        borderTopColor: c.line,
      }}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const label = s[route.name as keyof typeof s] ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            {focused ? <View style={{ position: 'absolute', top: 0, width: 28, height: 3, backgroundColor: c.sky }} /> : null}
            <Icon as={ICONS[route.name] ?? Newspaper} size={24} color={focused ? 'brand' : 'inkMuted'} strokeWidth={focused ? 2.1 : 1.75} />
            <T variant="caption" color={focused ? 'brand' : 'inkMuted'} weight={focused ? 800 : 600} style={{ fontSize: 12, lineHeight: 16 }}>
              {label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  // Local edition reminders (skipping Shabbat / Yom Tov), push token registration, notification taps.
  useNotificationSync();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => (
        <>
          <GlobalPlayerDock />
          <TabBar {...props} />
        </>
      )}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="archive" />
      <Tabs.Screen name="saved" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
