# Building screens in the Tamzit app — guide for agents

## Read first
- `mobile/AGENTS.md` (Expo SDK 57: check https://docs.expo.dev/versions/v57.0.0/ before using any Expo API; never trust memory).
- Product & design (Hebrew): `design-system/README.md` (brand book), `design-system/app/01-plan.md`, `02-screens.md`, `03-editorial.md`. The component previews in `design-system/components/*/preview.html` + `components/bundle.js` show the intended look of every component and screen (web reference implementation — port the look, not the code).
- Data contract: `docs/api-contract.md`. Typed client: `src/lib/api.ts`, types `src/lib/types.ts`, hooks `src/lib/queries.ts`.

## Foundation (owned by the lead — do not edit; ask the lead via SendMessage to "main" if you need a change)
- `src/theme/tokens.ts`, `src/theme/ThemeProvider.tsx` — `const { c, scheme, textScale } = useTheme()`; colors `c.ink`, `c.surface`, … (same names as the design tokens, camelCase). Spacing `space[1..12]`, `radius`, `touchMin`.
- `src/components/ui.tsx` — `T` (text; variants display/title/headline/body/label/caption/overline; `color` is a token name; `weight`; `scaled` for news body), `Icon` (lucide-react-native icon component via `as`), `Button` (primary/secondary/quiet/whatsapp/sun/hero, `size="lg"`, `block`, `icon`, `loading`), `IconButton` (label required), `Chip`, `Segmented`, `OptionCard` (radio/`multi` checkbox card with `sample` shown when selected), `SwitchRow`, `LevelMeter`, `ListGroup`/`ListRow`, `SquaresMotif`, `Logo`, `Screen` (safe area; `scroll`, `header`, `footer`), `AppBar` (`back`, `title`, `subtitle`, `actions`), `Card` (tone raised/tint/good/sun/critical), `Steps`, `TextField`, `Loading`, `ErrorState`, `EmptyState`, `ForwardChevron`/`BackChevron`, `useIsRTL()`.
- `src/components/news/NewsItem.tsx` + `src/features/items/actions.ts` (`useItemActions()` → toggleSave/share/feedback; share opens `/share/[itemId]`, feedback opens `/feedback/[itemId]`, item data via `useItemStore` in `src/lib/itemStore.ts` — call `useItemStore.getState().remember(items)` / `remember` from the hook for every list you render).
- `src/lib/i18n.ts` — strings per module: `const S = defineStrings({he:{…}, en:{…}, fr:{…}}); const s = useStrings(S)`. Helpers: `useLang()`, `localName(row, lang)`, `EDITION_NAMES`, `LEVEL_NAMES`, `formatDay`, `formatTime`, `slotEditionType`.
- `src/lib/schedule.ts` (slots → current window, next slot), `src/lib/rtl.ts` (`applyDirection(lang)` reloads the app when direction changes), `src/state/prefs.ts` (zustand, persisted: language, audience, topics, communities, frequency, slotTimes, levelFilter, style, theme, textScale, shabbatCityId, onboardingDone), `src/state/session.ts` (`useSession()`), `src/app/_layout.tsx`, `src/app/index.tsx` (entry gate), `src/app/(tabs)/_layout.tsx` (tab bar).

## Rules
- Hebrew is the default and RTL. Write all UI copy in Hebrew, English and French (Hebrew first; follow the voice in design-system/README.md: plural "אתם", short, calm, no exclamation marks, no emoji). Use logical styles (`marginStart`, `paddingEnd`, `start`/`end`), never left/right, so LTR languages flip correctly. Use `ForwardChevron`/`BackChevron` for arrows.
- Colors only from `useTheme().c`; both light and dark themes must look right.
- Touch targets ≥ 44px; every icon-only button has a label; use `accessibilityRole`.
- Performance: FlatList/SectionList for long lists, memoized rows, no heavy work in render. Use React Query hooks (`src/lib/queries.ts` or your feature's own hooks) for server data, with loading/error/empty states.
- Put non-route code in `src/features/<your-area>/` (components, hooks, strings). Route files in `src/app/` stay thin.
- Do not add packages without asking the lead. Already installed: expo-router, expo-image, expo-audio, expo-notifications, expo-sharing, react-native-view-shot, react-native-svg, lucide-react-native, @expo-google-fonts/rubik, expo-localization, @tanstack/react-query, zustand, expo-haptics, expo-web-browser, expo-secure-store, @hebcal/core, @supabase/supabase-js, @react-native-async-storage/async-storage.
- Never edit `android/`, `ios/`, `app.json`, `package.json`, or files owned by another agent.

## Testing
- `npx tsc --noEmit` must pass for your files (other agents' in-progress errors are not yours — mention them).
- Web smoke test (for layout/flow only; Android is the target): start your own dev server on your assigned port:
  `cd mobile && CI=1 EXPO_NO_TELEMETRY=1 npx expo start --web --port <PORT>` (run it in the background), then
  `NODE_PATH=$(npm root -g) node /tmp/webtest/shot.js http://localhost:<PORT>/<route> /tmp/<you>/<name>.png 5000` and look at the PNG (390×844 phone viewport, Hebrew locale; prints console errors). Kill only your own server when done.
- Demo login (once the backend is deployed): phone `0500000000` code `123456` (free user) and `0500000001` code `123456` (premium user). For a logged-in web session you can also drive the login screens with Playwright.
- Commit only your own files: `git add <your paths>` then `git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "<message>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_016KBFZ7axBT2mqwsqbBbo5V"`. Retry if the git index is locked. Do not push.
