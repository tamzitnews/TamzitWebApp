// Web (previews only): load Rubik at runtime. Native builds embed the fonts (see fonts.ts).
import {
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
  Rubik_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/rubik';

export function useAppFonts(): boolean {
  const [loaded] = useFonts({ Rubik_400Regular, Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold, Rubik_800ExtraBold });
  return loaded;
}
