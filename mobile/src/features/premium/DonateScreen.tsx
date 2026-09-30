import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';

import { T } from '@/components/ui';
import { SettingsPage } from '@/features/settings/components';
import { api } from '@/lib/api';
import { parseAppConfig } from '@/lib/config';
import { useStrings } from '@/lib/i18n';
import { useAppSettings } from '@/lib/queries';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { DonationCard, type DonationFrequency } from './DonationCard';
import { DONATE_S } from './strings';

const parentLogo = require('@/assets/brand/lokchim-achrayut-logo.png');

export function DonateScreen() {
  const { c } = useTheme();
  const s = useStrings(DONATE_S);
  const settings = useAppSettings();
  const { session } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onDonate = async (amount: number, frequency: DonationFrequency) => {
    setLoading(true);
    setError(null);
    try {
      // The donation itself happens on the association's page; we only record the intent.
      if (session) await api.recordDonation(amount, frequency).catch(() => null);
      // The app setting donation_url (fetched now if the settings have not loaded yet), else the default.
      const url = parseAppConfig(settings.data ?? (await settings.refetch()).data).donation_url;
      await WebBrowser.openBrowserAsync(url);
      setDone(true);
    } catch {
      setError(s.errOpen);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsPage title={s.title}>
      <DonationCard onDonate={onDonate} loading={loading} error={error} />
      {done ? (
        <View accessibilityLiveRegion="polite">
          <T variant="label" color="ink" align="center">
            {s.thanks}
          </T>
        </View>
      ) : null}
      <T variant="caption" color="inkMuted">
        {s.secure}
      </T>
      <View style={{ alignSelf: 'flex-start', backgroundColor: c.logoPlate, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2] }}>
        <Image source={parentLogo} style={{ width: 140, height: 42 }} contentFit="contain" accessible accessibilityLabel={s.parentLabel} />
      </View>
      <T variant="caption" color="inkMuted">
        {s.about}
      </T>
    </SettingsPage>
  );
}
