// Native: Rubik is embedded in the app binary by the expo-font config plugin (app.json), under the
// same family names as tokens.ts (Rubik_400Regular…), so nothing loads at runtime.
export function useAppFonts(): boolean {
  return true;
}
