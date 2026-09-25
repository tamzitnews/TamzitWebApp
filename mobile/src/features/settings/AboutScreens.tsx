import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ExternalLink, FileText, Globe, Mail, ShieldCheck } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Icon, ListGroup, ListRow, T } from '@/components/ui';
import { defineStrings, useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { mailto, useSupportEmail } from './AccountSettings';
import { SettingsPage } from './components';
import { LUCIDE_ISC, RUBIK_OFL } from './licenseTexts';

const verticalLogo = require('@/assets/brand/tamzit-logo-vertical.jpg');
const parentLogo = require('@/assets/brand/lokchim-achrayut-logo.png');

const SITE_URL = 'https://tamzit.org.il';
// Placeholder until the privacy policy page is published.
const PRIVACY_URL = 'https://tamzit.org.il/privacy';

const S = defineStrings({
  he: {
    title: 'אודות',
    logoLabel: 'תמצית החדשות. להתנתק ולהישאר מחובר. מבית לוקחים אחריות',
    from: 'מבית לוקחים אחריות',
    text: 'תמצית החדשות מביאה את החדשות בקצרה, בזמנים קבועים ובלי רעש, כדי שתוכלו להתעדכן ולהניח את הטלפון. תמצית החדשות היא מחלקה של עמותת לוקחים אחריות, שפועלת לשימוש בריא ומאוזן ברשת ובמדיה.',
    version: (v: string) => `גרסה ${v}`,
    site: 'לאתר תמצית החדשות',
    privacy: 'מדיניות פרטיות',
    contact: 'יצירת קשר',
    contactSubject: 'פנייה מאפליקציית תמצית החדשות',
    licenses: 'רישיונות',
    parentLabel: 'לוקחים אחריות',
    // licenses screen
    licensesTitle: 'רישיונות',
    licensesNote: 'האפליקציה משתמשת בגופן ובאייקונים בקוד פתוח. תודה ליוצרים.',
    rubik: 'הגופן Rubik',
    lucide: 'האייקונים Lucide',
  },
  en: {
    title: 'About',
    logoLabel: 'Tamzit News. Disconnect and stay connected. By Lokchim Achrayut',
    from: 'By Lokchim Achrayut',
    text: 'Tamzit brings you the news in brief, at fixed times and without the noise, so you can catch up and put the phone down. Tamzit is a department of the Lokchim Achrayut association, which works for healthy, balanced use of the internet and media.',
    version: (v: string) => `Version ${v}`,
    site: 'Tamzit website',
    privacy: 'Privacy policy',
    contact: 'Contact us',
    contactSubject: 'Message from the Tamzit app',
    licenses: 'Licenses',
    parentLabel: 'Lokchim Achrayut',
    licensesTitle: 'Licenses',
    licensesNote: 'The app uses an open-source typeface and icon set. Thanks to their creators.',
    rubik: 'Rubik typeface',
    lucide: 'Lucide icons',
  },
  fr: {
    title: 'À propos',
    logoLabel: 'Tamzit. Se déconnecter et rester informé. Par Lokchim Achrayout',
    from: 'Par Lokchim Achrayout',
    text: 'Tamzit vous apporte l’actualité en bref, à heures fixes et sans bruit, pour vous informer puis poser le téléphone. Tamzit est un département de l’association Lokchim Achrayout, qui œuvre pour un usage sain et équilibré d’internet et des médias.',
    version: (v: string) => `Version ${v}`,
    site: 'Site de Tamzit',
    privacy: 'Politique de confidentialité',
    contact: 'Nous contacter',
    contactSubject: 'Message depuis l’application Tamzit',
    licenses: 'Licences',
    parentLabel: 'Lokchim Achrayout',
    licensesTitle: 'Licences',
    licensesNote: 'L’application utilise une police et des icônes open source. Merci à leurs créateurs.',
    rubik: 'Police Rubik',
    lucide: 'Icônes Lucide',
  },
});

/** White plate so the logos (dark ink on white) stay correct in the dark theme. */
function LogoPlate({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignSelf: 'center', backgroundColor: c.logoPlate, borderRadius: radius.lg, padding: space[4] }}>{children}</View>
  );
}

const open = (url: string) => () => {
  WebBrowser.openBrowserAsync(url).catch(() => {});
};

export function AboutScreen() {
  const s = useStrings(S);
  const support = useSupportEmail();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  return (
    <SettingsPage title={s.title}>
      <View style={{ alignItems: 'center', gap: space[3], paddingTop: space[2] }}>
        <LogoPlate>
          <Image source={verticalLogo} style={{ width: 150, height: 170 }} contentFit="contain" accessibilityLabel={s.logoLabel} accessible />
        </LogoPlate>
        <T variant="caption" color="inkMuted" align="center">
          {`${s.from} · ${s.version(version)}`}
        </T>
      </View>
      <T variant="body" style={{ fontSize: 16, lineHeight: 26 }}>
        {s.text}
      </T>
      <ListGroup>
        <ListRow icon={Globe} title={s.site} onPress={open(SITE_URL)} right={<Icon as={ExternalLink} size={18} color="inkMuted" />} chevron={false} />
        <ListRow icon={ShieldCheck} title={s.privacy} onPress={open(PRIVACY_URL)} right={<Icon as={ExternalLink} size={18} color="inkMuted" />} chevron={false} />
        <ListRow icon={Mail} title={s.contact} value={support} onPress={() => mailto(support, s.contactSubject)} chevron={false} />
        <ListRow icon={FileText} title={s.licenses} onPress={() => router.push('/licenses')} last />
      </ListGroup>
      <View style={{ alignItems: 'center', paddingTop: space[2] }}>
        <LogoPlate>
          <Image source={parentLogo} style={{ width: 160, height: 48 }} contentFit="contain" accessibilityLabel={s.parentLabel} accessible />
        </LogoPlate>
      </View>
    </SettingsPage>
  );
}

type Para = { heading: boolean; text: string };

/** Reflows a plain-text license (hard-wrapped at 80 columns) into paragraphs and headings. */
function reflow(text: string): Para[] {
  const out: Para[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim());
    const ruled = lines.some((l) => /^-{5,}$/.test(l));
    const body = lines.filter((l) => l && !/^-{5,}$/.test(l));
    if (!body.length) continue;
    // "PREAMBLE", "DEFINITIONS", … start their paragraph on their own line.
    if (body.length > 1 && /^[A-Z][A-Z &]+$/.test(body[0])) {
      out.push({ heading: true, text: body[0] });
      body.shift();
    }
    out.push({ heading: ruled, text: body.join(' ') });
  }
  return out;
}

function LicenseCard({ title, license, text }: { title: string; license: string; text: string }) {
  const { c } = useTheme();
  const paras = useMemo(() => reflow(text), [text]);
  return (
    <View style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space[4], gap: space[3] }}>
      <View style={{ gap: 2 }}>
        <T variant="headline" accessibilityRole="header">
          {title}
        </T>
        <T variant="caption" color="inkMuted" style={{ writingDirection: 'ltr', alignSelf: 'flex-start' }}>
          {license}
        </T>
      </View>
      <View style={{ height: 1, backgroundColor: c.line }} />
      <View style={{ gap: space[3] }}>
        {paras.map((p, i) => (
          <T
            key={i}
            variant="caption"
            weight={p.heading ? 700 : 500}
            selectable
            align="left"
            style={{ writingDirection: 'ltr', fontSize: 13, lineHeight: 19 }}>
            {p.text}
          </T>
        ))}
      </View>
    </View>
  );
}

export function LicensesScreen() {
  const s = useStrings(S);
  return (
    <SettingsPage title={s.licensesTitle} note={s.licensesNote}>
      <LicenseCard title={s.rubik} license="SIL Open Font License 1.1 · Copyright 2015 The Rubik Project Authors" text={RUBIK_OFL} />
      <LicenseCard title={s.lucide} license="ISC License · Copyright (c) 2026 Lucide Icons and Contributors" text={LUCIDE_ISC} />
    </SettingsPage>
  );
}
