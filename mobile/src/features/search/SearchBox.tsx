import { Search, X } from 'lucide-react-native';
import { useState, type Ref } from 'react';
import { ActivityIndicator, Platform, Pressable, TextInput, View } from 'react-native';

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
  busyLabel,
  autoFocus,
  editable = true,
}: {
  ref?: Ref<TextInput>;
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  clearLabel: string;
  busy?: boolean;
  busyLabel?: string;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const { c } = useTheme();
  const rtl = useIsRTL();
  // The pill's border shows focus (brand, thicker), replacing the browser outline on web.
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        minHeight: 48,
        borderRadius: radius.pill,
        borderWidth: focused ? 2 : 1.5,
        borderColor: focused ? c.brand : c.lineStrong,
        backgroundColor: c.surfaceRaised,
        flexDirection: 'row',
        alignItems: 'center',
        paddingStart: focused ? 13.5 : 14,
        paddingEnd: focused ? 3.5 : space[1],
        gap: space[2],
      }}>
      <Icon as={Search} size={20} color="inkMuted" />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={c.inkMuted}
        autoFocus={autoFocus}
        editable={editable}
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
          ...(Platform.OS === 'web' ? { outlineWidth: 0 } : null),
        }}
      />
      {busy ? <ActivityIndicator size="small" color={c.brand} accessibilityLabel={busyLabel} /> : null}
      {value.length > 0 && editable ? (
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
