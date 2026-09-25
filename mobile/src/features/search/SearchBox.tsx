import { Search, X } from 'lucide-react-native';
import type { Ref } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Icon, useIsRTL } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space, touchMin } from '@/theme/tokens';

/** The search input (design-system SearchField): pill, search icon, clear button, busy spinner. */
export function SearchBox({
  ref,
  value,
  onChangeText,
  onSubmit,
  label,
  placeholder,
  clearLabel,
  busy,
  autoFocus,
}: {
  ref?: Ref<TextInput>;
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  clearLabel: string;
  busy?: boolean;
  autoFocus?: boolean;
}) {
  const { c } = useTheme();
  const rtl = useIsRTL();
  return (
    <View
      style={{
        minHeight: 48,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: c.lineStrong,
        backgroundColor: c.surfaceRaised,
        flexDirection: 'row',
        alignItems: 'center',
        paddingStart: 14,
        paddingEnd: space[1],
        gap: space[2],
      }}>
      <Icon as={Search} size={20} color="inkMuted" />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={c.inkMuted}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        enterKeyHint="search"
        inputMode="search"
        selectionColor={c.brand}
        maxLength={120}
        style={{
          flex: 1,
          minHeight: 46,
          paddingVertical: 0,
          color: c.ink,
          fontFamily: fonts[400],
          fontSize: 16,
          textAlign: rtl ? 'right' : 'left',
          writingDirection: 'auto',
        }}
      />
      {busy ? <ActivityIndicator size="small" color={c.brand} /> : null}
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          onPress={() => onChangeText('')}
          hitSlop={4}
          style={({ pressed }) => ({
            width: touchMin,
            height: touchMin,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}>
          <Icon as={X} size={20} color="inkMuted" />
        </Pressable>
      ) : (
        <View style={{ width: space[2] }} />
      )}
    </View>
  );
}
