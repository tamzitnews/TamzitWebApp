import { router, type Href } from 'expo-router';
import {
  Bell,
  Clock,
  Feather,
  FileText,
  Flame,
  Globe,
  HeartHandshake,
  Info,
  LogIn,
  MapPin,
  MessageSquareText,
  SlidersHorizontal,
  Star,
  SunMoon,
  Type,
  UserRound,
  Users,
  Gauge,
  GraduationCap,
} from 'lucide-react-native';
import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { AppBar, ErrorState, ForwardChevron, Icon, ListGroup, ListRow, Loading, Screen, T } from '@/components/ui';
import { SupporterBadge } from '@/features/premium/SupporterBadge';
import { useFamilyMembers } from '@/features/premium/queries';
import { useShabbatCity } from '@/features/shabbat/hooks';
import { localName, useLang, useStrings } from '@/lib/i18n';
import { useCommunities } from '@/lib/queries';
import type { Me } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { formatPhone, useNotificationPermission, useProfileValues } from './hooks';
import { SETTINGS_S, VALUE_LABELS } from './strings';

const go = (href: Href) => () => router.push(href);

const ProfileHeader = memo(function ProfileHeader({ me }: { me: Me }) {
  const { c } = useTheme();
  const s = useStrings(SETTINGS_S);
  const name = me.profile.full_name?.trim() || s.guest;
  const supporter = me.plan === 'premium' || me.plan === 'family' || me.is_premium;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}${supporter ? `, ${s.supporter}` : ''}. ${s.personal}`}
      onPress={go('/settings/account')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceRaised,
        opacity: pressed ? 0.8 : 1,
      })}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
        <T variant="title" color="ink">
          {name.charAt(0)}
        </T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space[2] }}>
          <T variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </T>
          {supporter ? <SupporterBadge label={s.supporter} /> : null}
        </View>
        <T variant="caption" color="inkMuted" style={{ writingDirection: 'ltr', alignSelf: 'flex-start' }}>
          {formatPhone(me.profile.phone)}
        </T>
      </View>
      <ForwardChevron />
    </Pressable>
  );
});

function SignInCard() {
  const { c } = useTheme();
  const s = useStrings(SETTINGS_S);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={go('/auth/login')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: c.surfaceRaised,
        opacity: pressed ? 0.8 : 1,
      })}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon as={LogIn} size={24} color="ink" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="headline">{s.signIn}</T>
        <T variant="caption" color="inkMuted">
          {s.signInHint}
        </T>
      </View>
      <ForwardChevron />
    </Pressable>
  );
}

/** The Settings tab. */
export function SettingsHome() {
  const s = useStrings(SETTINGS_S);
  const lang = useLang();
  const { values: v, me, signedIn, sessionLoading } = useProfileValues();
  const communities = useCommunities();
  const city = useShabbatCity();
  const { permission } = useNotificationPermission();
  const data = me.data;
  const family = useFamilyMembers(data?.family_role === 'owner' ? data.profile.id : undefined);

  if (sessionLoading || (signedIn && me.isLoading)) {
    return (
      <Screen header={<AppBar title={s.title} logo={false} />}>
        <Loading />
      </Screen>
    );
  }
  if (signedIn && me.isError && !data) {
    return (
      <Screen header={<AppBar title={s.title} logo={false} />}>
        <ErrorState message={s.loadError} retryLabel={s.retry} onRetry={() => me.refetch()} />
      </Screen>
    );
  }

  const topicsValue = v.topics.length ? s.topicsCount(v.topics.length) : s.topicsAll;
  const firstCommunity = localName(communities.data?.find((x) => x.id === v.communities[0]), lang);
  const commValue =
    v.communities.length === 0
      ? s.none
      : v.communities.length === 1 && firstCommunity
        ? firstCommunity
        : s.communitiesCount(v.communities.length);

  const notifValue =
    permission === 'denied'
      ? s.notifBlocked
      : v.edition_push && v.special_push
        ? s.notifOn
        : v.edition_push
          ? s.notifEditionsOnly
          : v.special_push
            ? s.notifSpecialOnly
            : s.notifOff;

  const themeValue = v.theme === 'light' ? s.themeLight : v.theme === 'dark' ? s.themeDark : s.themeSystem;
  const premiumValue = !data
    ? undefined
    : data.plan === 'family'
      ? s.premiumFamily
      : data.plan === 'premium' || data.is_premium
        ? s.premiumActive
        : s.premiumInactive;
  const familyValue =
    data?.family_role === 'owner'
      ? s.familyCount(1 + (family.data?.length ?? 0))
      : data?.family_role === 'member'
        ? s.familyMember
        : undefined;
  const unread = data?.unread_messages ?? 0;

  return (
    <Screen scroll header={<AppBar title={s.title} logo={false} />} contentStyle={{ paddingTop: space[2] }}>
      {data ? <ProfileHeader me={data} /> : <SignInCard />}

      <ListGroup label={s.gEditions}>
        <ListRow icon={Globe} title={s.language} value={VALUE_LABELS.language[v.language]} onPress={go('/settings/language')} />
        <ListRow icon={GraduationCap} title={s.track} value={VALUE_LABELS.audience[lang][v.audience]} onPress={go('/settings/track')} />
        <ListRow icon={SlidersHorizontal} title={s.topics} value={topicsValue} onPress={go('/settings/topics')} />
        <ListRow icon={Clock} title={s.rhythm} value={s.perDay(v.frequency)} onPress={go('/settings/rhythm')} />
        <ListRow icon={Gauge} title={s.level} value={VALUE_LABELS.level[lang][v.level_filter]} onPress={go('/settings/level')} />
        <ListRow icon={Feather} title={s.style} value={VALUE_LABELS.style[lang][v.style]} onPress={go('/settings/style')} />
        <ListRow icon={MapPin} title={s.communities} value={commValue} onPress={go('/settings/communities')} last />
      </ListGroup>

      <ListGroup label={s.gNotifications}>
        <ListRow icon={Bell} title={s.notifications} value={notifValue} onPress={go('/settings/notifications')} last />
      </ListGroup>

      <ListGroup label={s.gReading}>
        <ListRow icon={Type} title={s.textSize} value={`${Math.round(v.text_scale * 100)}%`} onPress={go('/settings/display')} />
        <ListRow icon={SunMoon} title={s.theme} value={themeValue} onPress={go('/settings/display')} last />
      </ListGroup>

      <ListGroup label={s.gShabbat}>
        <ListRow icon={Flame} title={s.shabbatMode} value={s.alwaysOn} chevron={false} />
        <ListRow icon={MapPin} title={s.shabbatCity} value={localName(city, lang)} onPress={go('/settings/shabbat-city')} last />
      </ListGroup>

      <ListGroup label={s.gSupport}>
        <ListRow icon={Star} title={s.premium} value={premiumValue} onPress={go('/premium')} />
        <ListRow icon={Users} title={s.family} value={familyValue} onPress={go('/family')} />
        <ListRow icon={HeartHandshake} title={s.donate} onPress={go('/donate')} last />
      </ListGroup>

      {signedIn ? (
        <ListGroup label={s.gAccount}>
          <ListRow icon={UserRound} title={s.personal} onPress={go('/settings/account')} />
          <ListRow icon={MessageSquareText} title={s.messages} value={unread ? s.unread(unread) : undefined} onPress={go('/messages')} last />
        </ListGroup>
      ) : null}

      <ListGroup label={s.gAbout}>
        <ListRow icon={Info} title={s.aboutApp} onPress={go('/about')} />
        <ListRow icon={FileText} title={s.licenses} onPress={go('/licenses')} last />
      </ListGroup>
    </Screen>
  );
}
