import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { HeartHandshake, Users, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ForwardChevron, Icon, IconButton, SquaresMotif, T } from '@/components/ui';
import { Sheet } from '@/features/settings/components';
import { useStrings } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { PlanCard } from './PlanCard';
import { SupporterBadge } from './SupporterBadge';
import { PREMIUM_S } from './strings';

const MOTIF = 88;

/** Store billing is not wired yet: explains that subscriptions open soon. */
function ComingSoonSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStrings(PREMIUM_S);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={s.soonTitle}
      actions={
        <>
          <Button
            block
            variant="secondary"
            icon={HeartHandshake}
            onPress={() => {
              onClose();
              router.push('/donate');
            }}>
            {s.donate}
          </Button>
          <Button block onPress={onClose}>
            {s.ok}
          </Button>
        </>
      }>
      <T variant="body" style={{ fontSize: 16, lineHeight: 25 }}>
        {s.soonText}
      </T>
      <T variant="body" color="inkMuted" style={{ fontSize: 16, lineHeight: 25 }}>
        {s.soonWhatsapp}
      </T>
      <T variant="body" color="inkMuted" style={{ fontSize: 16, lineHeight: 25 }}>
        {s.soonDonate}
      </T>
    </Sheet>
  );
}

export function PremiumScreen() {
  const { c } = useTheme();
  const s = useStrings(PREMIUM_S);
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const me = useMe(!!session);
  const [sheet, setSheet] = useState(false);

  const plan = me.data?.plan ?? 'free';
  const role = me.data?.family_role ?? null;
  const supporter = plan !== 'free' || !!me.data?.is_premium;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));
  const openSheet = () => setSheet(true);

  const activeText =
    plan === 'family' ? (role === 'owner' ? s.activeFamilyOwner : s.activeFamilyMember) : s.activePremium;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} bounces={false}>
        <View
          style={{
            backgroundColor: c.surfaceHero,
            paddingTop: insets.top + space[3],
            paddingHorizontal: space[5],
            paddingBottom: space[8] + space[4],
            overflow: 'hidden',
          }}>
          <SquaresMotif size={MOTIF} style={{ position: 'absolute', top: 0, end: 0 }} />
          <View style={{ marginStart: -10, alignSelf: 'flex-start' }}>
            <IconButton icon={X} label={s.close} variant="hero" onPress={close} />
          </View>
          {/* The title starts below the squares motif (88px at the top corner), never behind it. */}
          <T
            variant="display"
            color="onHero"
            accessibilityRole="header"
            style={{ fontSize: 26, lineHeight: 32, marginTop: Math.max(space[3], MOTIF + 4 - (insets.top + space[3] + 44)), marginBottom: space[2] }}>
            {s.title}
          </T>
          <T variant="body" color="onHeroMuted" style={{ fontSize: 16, lineHeight: 24, maxWidth: 290 }}>
            {s.subtitle}
          </T>
        </View>

        <View
          style={{
            marginTop: -space[4],
            borderTopStartRadius: radius.lg,
            borderTopEndRadius: radius.lg,
            backgroundColor: c.surface,
            paddingHorizontal: space[5],
            paddingTop: space[8],
            gap: space[6],
          }}>
          {supporter ? (
            <Card tone="sun" style={{ gap: space[2] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <SupporterBadge label={s.supporter} />
                <T variant="label" style={{ flex: 1 }}>
                  {s.thanks}
                </T>
              </View>
              <T variant="caption" color="ink">
                {activeText}
              </T>
              {plan === 'family' && role === 'owner' ? (
                <Button variant="secondary" icon={Users} onPress={() => router.push('/family')} style={{ alignSelf: 'flex-start', marginTop: space[1] }}>
                  {s.manageFamily}
                </Button>
              ) : null}
            </Card>
          ) : null}

          <PlanCard
            name={s.premiumName}
            price={s.premiumPrice}
            features={s.premiumFeatures}
            highlighted
            ribbon={s.ribbon}
            cta={plan === 'free' ? s.join : undefined}
            current={plan === 'premium'}
            currentLabel={s.current}
            onPress={openSheet}
          />
          <PlanCard
            name={s.familyName}
            price={s.familyPrice}
            features={s.familyFeatures}
            cta={plan !== 'family' ? s.join : undefined}
            current={plan === 'family'}
            currentLabel={s.current}
            onPress={openSheet}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/donate')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              padding: space[4],
              borderRadius: radius.lg,
              backgroundColor: c.surfaceRaised,
              opacity: pressed ? 0.8 : 1,
            })}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.criticalSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon as={HeartHandshake} size={22} color="ink" />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="caption" color="inkMuted">
                {s.donateLead}
              </T>
              <T variant="label">{s.donate}</T>
            </View>
            <ForwardChevron />
          </Pressable>
        </View>
      </ScrollView>

      {plan === 'free' ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.line,
            backgroundColor: c.surface,
            paddingHorizontal: space[5],
            paddingTop: space[3],
            paddingBottom: insets.bottom + space[3],
            gap: space[2],
          }}>
          <Button block size="lg" onPress={openSheet}>
            {s.joinPremium}
          </Button>
          <T variant="caption" color="inkMuted" align="center">
            {s.renew}
          </T>
        </View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}

      <ComingSoonSheet visible={sheet} onClose={() => setSheet(false)} />
    </View>
  );
}
