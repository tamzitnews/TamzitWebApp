// City of residence for registration: a searchable list of Israeli cities (app_cities), or free text.
import { Check, ChevronDown, PenLine, Search, X } from 'lucide-react-native';
import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, IconButton, T, useIsRTL } from '@/components/ui';
import { defineStrings, localName, useLang, useStrings } from '@/lib/i18n';
import { useCities } from '@/lib/queries';
import type { City } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space, touchMin } from '@/theme/tokens';

export type CityValue = { name: string; id: string | null };

const S = defineStrings({
  he: {
    placeholder: 'בחרו מהרשימה או הקלידו',
    title: 'עיר מגורים',
    search: 'חיפוש עיר',
    useText: (q: string) => `להשתמש ב־„${q}”`,
    clear: 'ניקוי העיר',
    close: 'סגירה',
    loadError: 'לא הצלחנו לטעון את רשימת הערים. אפשר להקליד את שם העיר.',
    noMatch: 'לא מצאנו עיר בשם הזה. אפשר להשתמש בשם שהקלדתם.',
  },
  en: {
    placeholder: 'Choose or type a city',
    title: 'City',
    search: 'Search for a city',
    useText: (q: string) => `Use “${q}”`,
    clear: 'Clear city',
    close: 'Close',
    loadError: "We couldn't load the list of cities. You can type the city name.",
    noMatch: 'No city by that name. You can use the name you typed.',
  },
  fr: {
    placeholder: 'Choisir ou saisir une ville',
    title: 'Ville',
    search: 'Rechercher une ville',
    useText: (q: string) => `Utiliser « ${q} »`,
    clear: 'Effacer la ville',
    close: 'Fermer',
    loadError: "Nous n'avons pas pu charger la liste des villes. Vous pouvez saisir le nom de la ville.",
    noMatch: 'Aucune ville de ce nom. Vous pouvez utiliser le nom saisi.',
  },
});

const norm = (x: string | null | undefined) => (x ?? '').toLowerCase().replace(/["'״׳\-־\s.]/g, '');

const CityRow = memo(function CityRow({ city, name, selected, onPick }: { city: City; name: string; selected: boolean; onPick: (c: City) => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onPick(city)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        paddingHorizontal: space[5],
        gap: space[3],
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        backgroundColor: pressed ? c.surfaceTint : 'transparent',
      })}>
      <T variant="label" weight={selected ? 700 : 500} style={{ flex: 1 }}>{name}</T>
      {selected ? <Icon as={Check} size={20} color="brand" strokeWidth={2.25} /> : null}
    </Pressable>
  );
});

function CityPicker({ value, onPick, onClose }: { value: CityValue | null; onPick: (v: CityValue) => void; onClose: () => void }) {
  const { c } = useTheme();
  const s = useStrings(S);
  const lang = useLang();
  const rtl = useIsRTL();
  const cities = useCities();
  const [q, setQ] = useState('');

  const israeli = useMemo(() => (cities.data ?? []).filter((x) => x.in_israel), [cities.data]);
  const filtered = useMemo(() => {
    const nq = norm(q);
    if (!nq) return israeli;
    return israeli.filter((x) => [x.name_he, x.name_en, x.name_fr].some((n) => norm(n).includes(nq)));
  }, [israeli, q]);
  const typed = q.trim();
  const exact = filtered.some((x) => [x.name_he, x.name_en, x.name_fr].some((n) => norm(n) === norm(typed)));

  const pickCity = (city: City) => onPick({ name: localName(city, lang), id: city.id });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: c.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[5] }}>
          <T variant="label" weight={800} style={{ flex: 1, fontSize: 17 }} accessibilityRole="header">{s.title}</T>
          <IconButton icon={X} label={s.close} onPress={onClose} variant="tint" />
        </View>
        <View style={{ paddingHorizontal: space[5], paddingBottom: space[3] }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              minHeight: 52,
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: c.lineStrong,
              backgroundColor: c.surfaceRaised,
              paddingHorizontal: space[4],
            }}>
            <Icon as={Search} size={20} color="inkMuted" />
            <TextInput
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder={s.search}
              placeholderTextColor={c.inkMuted}
              accessibilityLabel={s.search}
              returnKeyType="done"
              autoCorrect={false}
              onSubmitEditing={() => {
                if (filtered.length === 1) pickCity(filtered[0]);
                else if (typed) onPick({ name: typed, id: null });
              }}
              style={{ flex: 1, minHeight: 48, color: c.ink, fontFamily: fonts[400], fontSize: 17, textAlign: rtl ? 'right' : 'left' }}
            />
          </View>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(x) => x.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          ListHeaderComponent={
            <>
              {typed && !exact ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPick({ name: typed, id: null })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[3],
                    minHeight: 52,
                    paddingHorizontal: space[5],
                    borderBottomWidth: 1,
                    borderBottomColor: c.line,
                    backgroundColor: pressed ? c.surfaceTint : 'transparent',
                  })}>
                  <Icon as={PenLine} size={20} color="link" />
                  <T variant="label" color="link" style={{ flex: 1 }}>{s.useText(typed)}</T>
                </Pressable>
              ) : null}
              {cities.isPending ? (
                <View style={{ padding: space[6] }}>
                  <ActivityIndicator color={c.brand} />
                </View>
              ) : null}
              {cities.isError ? (
                <T variant="caption" color="inkMuted" style={{ padding: space[5] }}>{s.loadError}</T>
              ) : null}
              {cities.isSuccess && typed && filtered.length === 0 ? (
                <T variant="caption" color="inkMuted" style={{ padding: space[5] }}>{s.noMatch}</T>
              ) : null}
            </>
          }
          renderItem={({ item }) => (
            <CityRow city={item} name={localName(item, lang)} selected={value?.id === item.id} onPick={pickCity} />
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

/** Looks like a TextField; opens the searchable list. */
export function CityField({
  label,
  optional,
  hint,
  value,
  onChange,
}: {
  label: string;
  optional?: string;
  hint?: string;
  value: CityValue | null;
  onChange: (v: CityValue | null) => void;
}) {
  const { c } = useTheme();
  const s = useStrings(S);
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space[2] }}>
      <T variant="caption" weight={600}>
        {label}
        {optional ? <T variant="caption" color="inkMuted"> {optional}</T> : null}
      </T>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 52,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: c.lineStrong,
          backgroundColor: c.surfaceRaised,
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={value ? `${label}: ${value.name}` : label}
          onPress={() => setOpen(true)}
          style={{ flex: 1, minHeight: 52, justifyContent: 'center', paddingHorizontal: space[4] }}>
          <T variant="body" color={value ? 'ink' : 'inkMuted'} numberOfLines={1} style={{ fontSize: 17 }}>
            {value ? value.name : s.placeholder}
          </T>
        </Pressable>
        {value ? (
          <IconButton icon={X} label={s.clear} onPress={() => onChange(null)} />
        ) : (
          <View style={{ width: touchMin, alignItems: 'center' }} pointerEvents="none">
            <Icon as={ChevronDown} size={20} color="inkMuted" />
          </View>
        )}
      </View>
      {hint ? <T variant="caption" color="inkMuted">{hint}</T> : null}
      {open ? (
        <CityPicker
          value={value}
          onClose={() => setOpen(false)}
          onPick={(v) => {
            setOpen(false);
            onChange(v);
          }}
        />
      ) : null}
    </View>
  );
}
