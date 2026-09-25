// Base UI components of the Tamzit design system (design-system/components). Every screen builds
// from these; colors always come from the theme tokens (useTheme().c), never literal hex.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Check, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Switch as RNSwitch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { isRTL, useLang, LEVEL_NAMES } from '@/lib/i18n';
import type { Level } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space, touchMin, type as typeScale, type ColorName, type FontWeight, type TypeVariant } from '@/theme/tokens';

const markImg = require('@/assets/brand/tamzit-mark.png');
const logoImg = require('@/assets/brand/tamzit-logo-horizontal.png');

/** True when the current UI language is right-to-left (Hebrew). */
export function useIsRTL() {
  return isRTL(useLang());
}

// ---------------------------------------------------------------- Text

type TProps = {
  variant?: TypeVariant;
  color?: ColorName;
  weight?: FontWeight;
  align?: 'auto' | 'left' | 'right' | 'center';
  /** Scale with the reader's text-size setting (news body text). */
  scaled?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
  selectable?: boolean;
  accessibilityRole?: 'header' | 'text' | 'link';
};

export function T({ variant = 'body', color = 'ink', weight, align, scaled, style, children, ...rest }: TProps) {
  const { c, textScale } = useTheme();
  const v = typeScale[variant];
  const k = scaled ? textScale : 1;
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fonts[weight ?? v.weight],
          fontSize: v.size * k,
          lineHeight: v.line * k,
          color: c[color],
          textAlign: align ?? 'auto',
          writingDirection: 'auto',
          letterSpacing: variant === 'overline' ? 0.3 : 0,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------- Icon

export function Icon({ as: Cmp, size = 22, color = 'ink', strokeWidth = 1.75, fill }: {
  as: LucideIcon;
  size?: number;
  color?: ColorName;
  strokeWidth?: number;
  fill?: boolean;
}) {
  const { c } = useTheme();
  return <Cmp size={size} color={c[color]} strokeWidth={strokeWidth} fill={fill ? c[color] : 'none'} />;
}

/** A chevron that points "forward" in the reading direction (left in Hebrew, right in English). */
export function ForwardChevron({ size = 20, color = 'inkMuted' }: { size?: number; color?: ColorName }) {
  return <Icon as={useIsRTL() ? ChevronLeft : ChevronRight} size={size} color={color} />;
}
export function BackChevron({ size = 24, color = 'ink' }: { size?: number; color?: ColorName }) {
  return <Icon as={useIsRTL() ? ChevronRight : ChevronLeft} size={size} color={color} />;
}

// ---------------------------------------------------------------- Buttons

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'whatsapp' | 'sun' | 'hero';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  block,
  icon,
  iconFill,
  loading,
  disabled,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  block?: boolean;
  icon?: LucideIcon;
  iconFill?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const map: Record<ButtonVariant, { bg: string; fg: ColorName; border?: string }> = {
    primary: { bg: c.brand, fg: 'onBrand' },
    secondary: { bg: 'transparent', fg: 'brand', border: c.brand },
    quiet: { bg: 'transparent', fg: 'link' },
    whatsapp: { bg: c.whatsapp, fg: 'onWhatsapp' },
    sun: { bg: c.sun, fg: 'onSun' },
    hero: { bg: c.onHero, fg: 'surfaceHero' },
  };
  const v = map[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? 52 : touchMin,
          paddingHorizontal: variant === 'quiet' ? space[3] : size === 'lg' ? space[6] : space[5],
          borderRadius: radius.pill,
          backgroundColor: v.bg,
          borderWidth: v.border ? 1.5 : 0,
          borderColor: v.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space[2],
          alignSelf: block ? 'stretch' : 'auto',
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c[v.fg]} />
      ) : (
        <>
          {icon ? <Icon as={icon} size={20} color={v.fg} fill={iconFill} /> : null}
          <T variant="label" color={v.fg} style={size === 'lg' ? { fontSize: 17 } : undefined}>
            {children}
          </T>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  variant = 'plain',
  selected,
  fill,
  size = 22,
  color,
}: {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  variant?: 'plain' | 'tint' | 'hero';
  selected?: boolean;
  fill?: boolean;
  size?: number;
  color?: ColorName;
}) {
  const { c } = useTheme();
  const fg: ColorName = color ?? (variant === 'hero' ? 'onHero' : selected ? 'brand' : variant === 'tint' ? 'ink' : 'inkMuted');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        width: touchMin,
        height: touchMin,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: variant === 'tint' ? c.surfaceTint : 'transparent',
        opacity: pressed ? 0.6 : 1,
      })}>
      <Icon as={icon} size={size} color={fg} fill={fill} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- Selection

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: LucideIcon }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: touchMin,
        paddingHorizontal: space[4],
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? c.brand : c.lineStrong,
        backgroundColor: selected ? c.surfaceTint : c.surfaceRaised,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        opacity: pressed ? 0.8 : 1,
      })}>
      {selected ? <Icon as={Check} size={18} color="brand" strokeWidth={2.25} /> : icon ? <Icon as={icon} size={18} /> : null}
      <T variant="label">{label}</T>
    </Pressable>
  );
}

export type SegOption<V extends string | number> = { value: V; label: string; hint?: string };

export function Segmented<V extends string | number>({
  legend,
  options,
  value,
  onChange,
}: {
  legend?: string;
  options: SegOption<V>[];
  value: V;
  onChange: (v: V) => void;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={legend} style={{ gap: space[2] }}>
      {legend ? <T variant="caption" color="inkMuted" weight={600}>{legend}</T> : null}
      <View
        style={{
          flexDirection: 'row',
          gap: space[1],
          padding: space[1],
          borderRadius: radius.pill,
          backgroundColor: c.surfaceRaised,
          borderWidth: 1.5,
          borderColor: c.lineStrong,
        }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o.value)}
              style={{
                flex: 1,
                minHeight: touchMin,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: space[2],
                paddingVertical: space[1],
                backgroundColor: on ? c.brand : 'transparent',
              }}>
              <T variant="label" color={on ? 'onBrand' : 'ink'} align="center">{o.label}</T>
              {o.hint ? <T variant="caption" color={on ? 'onBrand' : 'inkMuted'} align="center" style={{ fontSize: 12, lineHeight: 16 }}>{o.hint}</T> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Radio card: title, description, and a sample shown only when selected. */
export function OptionCard({
  title,
  description,
  sample,
  icon,
  media,
  selected,
  onPress,
  multi,
}: {
  title: string;
  description?: string;
  sample?: string;
  icon?: LucideIcon;
  media?: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  multi?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: selected ? c.surfaceTint : c.surfaceRaised,
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? c.brand : c.lineStrong,
        opacity: pressed ? 0.85 : 1,
      })}>
      {media ??
        (icon ? (
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.brand : c.surfaceTint }}>
            <Icon as={icon} size={22} color={selected ? 'onBrand' : 'ink'} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="label" weight={700} style={{ fontSize: 17, lineHeight: 24 }}>{title}</T>
        {description ? <T variant="caption" color="inkMuted">{description}</T> : null}
        {selected && sample ? (
          <View style={{ marginTop: space[2], paddingStart: space[3], borderStartWidth: 2, borderStartColor: c.brand }}>
            <T variant="body" style={{ fontSize: 15, lineHeight: 24 }}>{sample}</T>
          </View>
        ) : null}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: multi ? 6 : 11,
          borderWidth: 2,
          borderColor: selected ? c.brand : c.lineStrong,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
          backgroundColor: multi && selected ? c.brand : 'transparent',
        }}>
        {selected ? (multi ? <Icon as={Check} size={14} color="onBrand" strokeWidth={3} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand }} />) : null}
      </View>
    </Pressable>
  );
}

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingVertical: space[2] }}>
      <View style={{ flex: 1 }}>
        <T variant="label">{label}</T>
        {description ? <T variant="caption" color="inkMuted">{description}</T> : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: c.line, true: c.brand }}
        thumbColor={value ? c.onBrand : c.surfaceRaised}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------- Level meter

const LEVEL_N: Record<Level, number> = { critical: 3, important: 2, general: 1 };

/** Three squares; the filled count is the importance level. The word shows for critical. */
export function LevelMeter({ level, showLabel }: { level: Level; showLabel?: boolean }) {
  const { c } = useTheme();
  const lang = useLang();
  const n = LEVEL_N[level];
  const fill = level === 'critical' ? c.critical : c.brand;
  const label = LEVEL_NAMES[lang][level];
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: 8,
              height: 8,
              backgroundColor: i < n ? fill : 'transparent',
              borderWidth: i < n ? 0 : 1.5,
              borderColor: c.lineStrong,
            }}
          />
        ))}
      </View>
      {showLabel ? <T variant="overline" color={level === 'critical' ? 'criticalInk' : 'inkMuted'}>{label}</T> : null}
    </View>
  );
}

// ---------------------------------------------------------------- Lists

export function ListGroup({ label, children }: { label?: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View>
      {label ? (
        <T variant="overline" color="inkMuted" style={{ marginTop: space[6], marginBottom: space[2], marginHorizontal: space[1] }} accessibilityRole="header">
          {label}
        </T>
      ) : null}
      <View style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, paddingHorizontal: space[4] }}>{children}</View>
    </View>
  );
}

export function ListRow({
  icon,
  title,
  value,
  onPress,
  chevron = true,
  last,
  right,
  destructive,
}: {
  icon?: LucideIcon;
  title: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
  last?: boolean;
  right?: ReactNode;
  destructive?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: 56,
        paddingVertical: space[2],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.line,
        opacity: pressed ? 0.7 : 1,
      })}>
      {icon ? <Icon as={icon} size={22} color={destructive ? 'criticalInk' : 'inkMuted'} /> : null}
      <T variant="label" color={destructive ? 'criticalInk' : 'ink'} style={{ flex: 1 }}>{title}</T>
      {right}
      {value ? <T variant="caption" color="inkMuted">{value}</T> : null}
      {onPress && chevron ? <ForwardChevron /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------- Brand

export function SquaresMotif({ size = 48, flip, style }: { size?: number; flip?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const a = flip ? c.surfaceTint : c.sky;
  const b = flip ? c.sky : c.surfaceTint;
  return (
    <View style={style} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 2 2">
        <Rect x={0} y={1} width={1} height={1} fill={a} />
        <Rect x={1} y={0} width={1} height={1} fill={b} />
      </Svg>
    </View>
  );
}

/** The Tamzit logo. `horizontal` falls back to the mark in the dark theme (no reversed wordmark yet). */
export function Logo({ variant = 'mark', height = 36, decorative }: { variant?: 'mark' | 'horizontal'; height?: number; decorative?: boolean }) {
  const { scheme } = useTheme();
  const horizontal = variant === 'horizontal' && scheme === 'light';
  const ratio = horizontal ? 490 / 150 : 124 / 143;
  return (
    <Image
      source={horizontal ? logoImg : markImg}
      style={{ height, width: height * ratio }}
      contentFit="contain"
      accessibilityLabel={decorative ? undefined : 'תמצית החדשות'}
      accessible={!decorative}
    />
  );
}

// ---------------------------------------------------------------- Layout

/** Screen container: safe area + surface background. Use `scroll` for scrolling content. */
export function Screen({
  children,
  scroll,
  edges = ['top'],
  bg = 'surface',
  contentStyle,
  header,
  footer,
  scrollProps,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  bg?: ColorName;
  contentStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  footer?: ReactNode;
  scrollProps?: ScrollViewProps;
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c[bg] }}>
      {header}
      {scroll ? (
        <ScrollView
          {...scrollProps}
          contentContainerStyle={[{ paddingHorizontal: space[5], paddingBottom: space[8] }, contentStyle]}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

/** Top bar: mark (or back button), title and actions. */
export function AppBar({
  title,
  subtitle,
  back,
  onBack,
  logo = true,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  logo?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const lang = useLang();
  const backLabel = lang === 'he' ? 'חזרה' : lang === 'fr' ? 'Retour' : 'Back';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[5], paddingVertical: space[2] }}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          hitSlop={8}
          style={{ width: touchMin, height: touchMin, alignItems: 'center', justifyContent: 'center', marginStart: -10 }}>
          <BackChevron />
        </Pressable>
      ) : logo ? (
        <Logo height={36} decorative />
      ) : null}
      <View style={{ flex: 1 }}>
        {title ? <T variant="label" weight={800} style={{ fontSize: 17 }} accessibilityRole="header">{title}</T> : null}
        {subtitle ? <T variant="caption" color="inkMuted" style={{ fontSize: 13, lineHeight: 18 }}>{subtitle}</T> : null}
      </View>
      {children}
      {actions ? <View style={{ flexDirection: 'row', gap: space[1], marginEnd: -10 }}>{actions}</View> : null}
    </View>
  );
}

export function Card({ children, style, tone = 'raised' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'raised' | 'tint' | 'good' | 'sun' | 'critical' }) {
  const { c } = useTheme();
  const bg = { raised: c.surfaceRaised, tint: c.surfaceTint, good: c.goodSoft, sun: c.sunSoft, critical: c.criticalSoft }[tone];
  return <View style={[{ backgroundColor: bg, borderRadius: radius.lg, padding: space[4] }, style]}>{children}</View>;
}

/** Progress bars for multi-step flows (onboarding). */
export function Steps({ at, of }: { at: number; of: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: of, now: at }} style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: of }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < at ? c.brand : c.line }} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- Forms

export function TextField({
  label,
  hint,
  error,
  ltr,
  optional,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string; ltr?: boolean; optional?: string }) {
  const { c } = useTheme();
  const rtl = useIsRTL();
  return (
    <View style={{ gap: space[2] }}>
      <T variant="caption" weight={600}>
        {label}
        {optional ? <T variant="caption" color="inkMuted"> {optional}</T> : null}
      </T>
      <TextInput
        placeholderTextColor={c.inkMuted}
        {...input}
        accessibilityLabel={label}
        style={[
          {
            minHeight: 52,
            borderRadius: radius.md,
            borderWidth: 1.5,
            borderColor: error ? c.critical : c.lineStrong,
            backgroundColor: c.surfaceRaised,
            color: c.ink,
            paddingHorizontal: space[4],
            fontFamily: fonts[400],
            fontSize: 17,
            textAlign: rtl ? 'right' : 'left',
            writingDirection: ltr ? 'ltr' : 'auto',
          },
          input.style,
        ]}
      />
      {error ? <T variant="caption" color="criticalInk">{error}</T> : hint ? <T variant="caption" color="inkMuted">{hint}</T> : null}
    </View>
  );
}

// ---------------------------------------------------------------- States

export function Loading() {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[8] }}>
      <ActivityIndicator color={c.brand} size="large" />
    </View>
  );
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[8], gap: space[4] }}>
      <T variant="body" color="inkMuted" align="center">{message}</T>
      {onRetry ? <Button variant="secondary" onPress={onRetry}>{retryLabel ?? 'נסו שוב'}</Button> : null}
    </View>
  );
}

export function EmptyState({ icon, title, text, children }: { icon?: LucideIcon; title: string; text?: string; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: space[8], gap: space[3] }}>
      {icon ? (
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={icon} size={30} color="brand" />
        </View>
      ) : null}
      <T variant="title" align="center">{title}</T>
      {text ? <T variant="body" color="inkMuted" align="center">{text}</T> : null}
      {children}
    </View>
  );
}

export type { PressableProps };
