// Layout pieces shared by the first-run screens (onboarding, registration, login, permissions).
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';

import { BackChevron, Screen, Steps, T } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import { space, touchMin } from '@/theme/tokens';

/** Bottom call-to-action area (the big primary button and an optional quiet one). */
export function CtaArea({ children }: { children: ReactNode }) {
  return <View style={{ paddingTop: space[4], paddingHorizontal: space[5], paddingBottom: space[5], gap: space[2] }}>{children}</View>;
}

/** Keeps inputs and the CTA above the software keyboard (Expo guidance: padding on iOS; Android resizes). */
export function KeyboardAware({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {children}
    </KeyboardAvoidingView>
  );
}

/** Screen title block: display heading and an optional muted line. */
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="display" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 32 }}>{title}</T>
      {subtitle ? <T variant="caption" color="inkMuted" style={{ fontSize: 15, lineHeight: 22 }}>{subtitle}</T> : null}
    </View>
  );
}

const BACK: Record<string, string> = { he: 'חזרה', en: 'Back', fr: 'Retour' };

/** Onboarding frame: back button + progress, title, scrolling body, and the CTA at the bottom. */
export function OnboardingFrame({
  at,
  of,
  title,
  subtitle,
  onBack,
  cta,
  children,
}: {
  at: number;
  of: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  cta: ReactNode;
  children: ReactNode;
}) {
  const lang = useLang();
  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      contentStyle={{ gap: space[5], paddingTop: space[2] }}
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[5] }}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={BACK[lang]}
              onPress={onBack}
              hitSlop={8}
              style={{ width: touchMin, height: touchMin, alignItems: 'center', justifyContent: 'center', marginStart: -10 }}>
              <BackChevron />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }}>
            <Steps at={at} of={of} />
          </View>
        </View>
      }
      footer={<CtaArea>{cta}</CtaArea>}>
      <Heading title={title} subtitle={subtitle} />
      {children}
    </Screen>
  );
}

/** Back from a first-run screen: previous screen if there is one, otherwise `fallback`. */
export function backOr(fallback: Parameters<typeof router.replace>[0]) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
