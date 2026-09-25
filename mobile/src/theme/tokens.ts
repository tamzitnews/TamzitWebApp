// Design tokens from the Tamzit design system (design-system/tokens.json).
// Keep names identical to the design system so screens read like the spec.

export const palette = {
  light: {
    surface: '#F2FAFD',
    surfaceRaised: '#FFFFFF',
    surfaceTint: '#C5E9F5',
    surfaceHero: '#182551',
    line: '#D2D9E4',
    lineStrong: '#7A8BAA',
    ink: '#002653',
    inkMuted: '#4A5D7E',
    onHero: '#F2FAFD',
    onHeroMuted: '#A9B8D0',
    lineHero: 'rgba(255,255,255,0.2)',
    brand: '#1C3F79',
    onBrand: '#FFFFFF',
    sky: '#00ACEC',
    link: '#0A6CC4',
    critical: '#F65943',
    criticalInk: '#A24559',
    criticalSoft: '#F8C5C2',
    good: '#18CBA0',
    onGood: '#0E2220',
    goodSoft: '#C6E5E0',
    sun: '#FDD344',
    onSun: '#182551',
    sunSoft: '#FFE08C',
    whatsapp: '#25D366',
    onWhatsapp: '#0E2220',
    scrim: 'rgba(2,19,48,0.4)',
    logoPlate: '#FFFFFF',
  },
  dark: {
    surface: '#021330',
    surfaceRaised: '#182551',
    surfaceTint: '#1C3F79',
    surfaceHero: '#182551',
    line: '#283666',
    lineStrong: '#6F82AB',
    ink: '#F2FAFD',
    inkMuted: '#A9B8D0',
    onHero: '#F2FAFD',
    onHeroMuted: '#A9B8D0',
    lineHero: 'rgba(255,255,255,0.2)',
    brand: '#7CC6F2',
    onBrand: '#021330',
    sky: '#00ACEC',
    link: '#7CC6F2',
    critical: '#F65943',
    criticalInk: '#F8C5C2',
    criticalSoft: '#3D1A26',
    good: '#18CBA0',
    onGood: '#0E2220',
    goodSoft: '#0E2220',
    sun: '#FDD344',
    onSun: '#182551',
    sunSoft: '#3A2F0B',
    whatsapp: '#25D366',
    onWhatsapp: '#0E2220',
    scrim: 'rgba(0,0,0,0.65)',
    logoPlate: '#FFFFFF',
  },
} as const;

export type ColorName = keyof typeof palette.light;
export type Colors = Record<ColorName, string>;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 12: 48 } as const;
export const radius = { none: 0, md: 12, lg: 20, pill: 100 } as const;
export const touchMin = 44;

// Rubik static weights, loaded in the root layout with useFonts (@expo-google-fonts/rubik).
export const fonts = {
  400: 'Rubik_400Regular',
  500: 'Rubik_500Medium',
  600: 'Rubik_600SemiBold',
  700: 'Rubik_700Bold',
  800: 'Rubik_800ExtraBold',
} as const;
export type FontWeight = keyof typeof fonts;

// Type scale (design-system tokens tz-*). lineHeight in px.
export const type = {
  display: { size: 30, line: 36, weight: 800 },
  title: { size: 22, line: 28, weight: 700 },
  headline: { size: 18, line: 26, weight: 700 },
  body: { size: 17, line: 28, weight: 400 },
  label: { size: 16, line: 22, weight: 600 },
  caption: { size: 14, line: 20, weight: 500 },
  overline: { size: 13, line: 18, weight: 700 },
} as const satisfies Record<string, { size: number; line: number; weight: FontWeight }>;
export type TypeVariant = keyof typeof type;
