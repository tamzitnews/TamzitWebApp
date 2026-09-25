import { router } from 'expo-router';
import { MessageCircle, Star, Trash2, UserPlus, Users } from 'lucide-react-native';
import { memo, useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { Button, Card, EmptyState, ErrorState, Icon, IconButton, Loading, T, TextField } from '@/components/ui';
import { ConfirmSheet, SettingsPage } from '@/features/settings/components';
import { formatPhone } from '@/features/settings/hooks';
import { ApiError } from '@/lib/api';
import { useStrings } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import type { Me } from '@/lib/types';
import { useSession } from '@/state/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useFamilyInvite, useFamilyMembers, useFamilyRemove, type FamilyMember } from './queries';
import { FAMILY_S } from './strings';

const MAX_MEMBERS = 4; // plus the owner = 5

/** Loose client check; the server normalizes and validates (app_normalize_phone). */
function looksLikePhone(p: string) {
  const d = p.replace(/[^\d+]/g, '');
  return /^\+?\d{9,15}$/.test(d);
}

/** wa.me wants the number in international form without '+'. */
function waNumber(e164: string) {
  const d = e164.replace(/[^\d]/g, '');
  return d.startsWith('0') ? `972${d.slice(1)}` : d;
}

function sendWhatsapp(phone: string, text: string) {
  Linking.openURL(`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`).catch(() => {});
}

const MemberRow = memo(function MemberRow({
  m,
  last,
  onRemove,
  onWhatsapp,
}: {
  m: FamilyMember;
  last: boolean;
  onRemove: (m: FamilyMember) => void;
  onWhatsapp: (m: FamilyMember) => void;
}) {
  const { c } = useTheme();
  const s = useStrings(FAMILY_S);
  const name = m.member_name || formatPhone(m.member_phone);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        minHeight: 64,
        paddingVertical: space[2],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.line,
      }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
        <T variant="label">{name.charAt(0)}</T>
      </View>
      <View style={{ flex: 1 }}>
        <T variant="label" numberOfLines={1}>
          {name}
        </T>
        <T variant="caption" color="inkMuted">
          {`${formatPhone(m.member_phone)} · ${m.status === 'joined' ? s.joined : s.invited}`}
        </T>
      </View>
      {m.status === 'invited' ? <IconButton icon={MessageCircle} label={s.sendWhatsapp} onPress={() => onWhatsapp(m)} /> : null}
      <IconButton icon={Trash2} label={s.remove(name)} onPress={() => onRemove(m)} />
    </View>
  );
});

function OwnerView({ me }: { me: Me }) {
  const { c } = useTheme();
  const s = useStrings(FAMILY_S);
  const members = useFamilyMembers(me.profile.id);
  const invite = useFamilyInvite();
  const remove = useFamilyRemove();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastInvited, setLastInvited] = useState<{ name: string; phone: string } | null>(null);
  const [toRemove, setToRemove] = useState<FamilyMember | null>(null);

  const list = members.data ?? [];
  const full = list.length >= MAX_MEMBERS;
  const errName = name.trim().length < 2 ? s.errName : undefined;
  const errPhone = looksLikePhone(phone) ? undefined : s.errPhone;

  const submit = async () => {
    setSubmitted(true);
    setError(null);
    if (errName || errPhone) return;
    try {
      const row = (await invite.mutateAsync({ phone: phone.trim(), name: name.trim() })) as Partial<FamilyMember> | null;
      setLastInvited({ name: name.trim(), phone: row?.member_phone ?? phone.trim() });
      setName('');
      setPhone('');
      setSubmitted(false);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code.includes('invalid_phone')
          ? s.errPhone
          : code.includes('family_full')
            ? s.errFull
            : code.includes('not_family_owner')
              ? s.errOwner
              : s.errGeneric,
      );
    }
  };

  return (
    <>
      <T variant="body" color="inkMuted" style={{ fontSize: 16, lineHeight: 25 }}>
        {s.ownerIntro}
      </T>

      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: space[1] }}>
          <T variant="overline" color="inkMuted" accessibilityRole="header">
            {s.members}
          </T>
          <T variant="caption" color="inkMuted">
            {s.count(1 + list.length)}
          </T>
        </View>
        <View style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.lg, paddingHorizontal: space[4] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 64, borderBottomWidth: list.length || members.isLoading ? 1 : 0, borderBottomColor: c.line }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.sun, alignItems: 'center', justifyContent: 'center' }}>
              <Icon as={Star} size={18} color="onSun" fill />
            </View>
            <View style={{ flex: 1 }}>
              <T variant="label" numberOfLines={1}>{`${me.profile.full_name} (${s.you})`}</T>
              <T variant="caption" color="inkMuted">{`${formatPhone(me.profile.phone)} · ${s.owner}`}</T>
            </View>
          </View>
          {members.isLoading ? (
            <View style={{ paddingVertical: space[4] }}>
              <Loading />
            </View>
          ) : members.isError ? (
            <ErrorState message={s.loadError} retryLabel={s.retry} onRetry={() => members.refetch()} />
          ) : (
            list.map((m, i) => (
              <MemberRow
                key={m.member_phone}
                m={m}
                last={i === list.length - 1}
                onRemove={setToRemove}
                onWhatsapp={(x) => sendWhatsapp(x.member_phone, s.waText(x.member_name || ''))}
              />
            ))
          )}
        </View>
        {!members.isLoading && !members.isError && !list.length ? (
          <T variant="caption" color="inkMuted" style={{ marginHorizontal: space[1] }}>
            {s.empty}
          </T>
        ) : null}
      </View>

      {lastInvited ? (
        <Card tone="good" style={{ gap: space[3] }}>
          <T variant="label">{s.invitedOk(lastInvited.name)}</T>
          <Button variant="whatsapp" icon={MessageCircle} onPress={() => sendWhatsapp(lastInvited.phone, s.waText(lastInvited.name))}>
            {s.sendWhatsapp}
          </Button>
        </Card>
      ) : null}

      {full ? (
        <Card tone="tint">
          <T variant="body" style={{ fontSize: 16, lineHeight: 24 }}>
            {s.full}
          </T>
        </Card>
      ) : (
        <View style={{ gap: space[4], backgroundColor: c.surfaceRaised, borderRadius: radius.lg, padding: space[4] }}>
          <T variant="headline" accessibilityRole="header">
            {s.inviteTitle}
          </T>
          <TextField label={s.name} value={name} onChangeText={setName} autoComplete="name" error={submitted ? errName : undefined} />
          <TextField
            label={s.phone}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            ltr
            placeholder="050-000-0000"
            error={submitted ? errPhone : undefined}
          />
          <Button block icon={UserPlus} onPress={submit} loading={invite.isPending}>
            {s.invite}
          </Button>
          {error ? (
            <T variant="caption" color="criticalInk">
              {error}
            </T>
          ) : null}
        </View>
      )}

      <ConfirmSheet
        visible={!!toRemove}
        title={s.removeTitle}
        text={toRemove ? s.removeText(toRemove.member_name || formatPhone(toRemove.member_phone)) : undefined}
        confirm={s.removeConfirm}
        cancel={s.cancel}
        loading={remove.isPending}
        onConfirm={async () => {
          if (!toRemove) return;
          try {
            await remove.mutateAsync(toRemove.member_phone);
          } catch {
            setError(s.errGeneric);
          }
          setToRemove(null);
        }}
        onCancel={() => setToRemove(null)}
      />
    </>
  );
}

export function FamilyScreen() {
  const s = useStrings(FAMILY_S);
  const { session, loading } = useSession();
  const me = useMe(!!session);
  const data = me.data;

  let body: ReactNode;
  if (loading || (session && me.isLoading)) body = <Loading />;
  else if (data?.family_role === 'owner') body = <OwnerView me={data} />;
  else if (data?.family_role === 'member')
    body = <EmptyState icon={Users} title={s.memberTitle} text={s.memberText} />;
  else
    body = (
      <EmptyState icon={Users} title={s.otherTitle} text={s.otherText}>
        <Button onPress={() => router.push('/premium')}>{s.toPremium}</Button>
      </EmptyState>
    );

  return <SettingsPage title={s.title}>{body}</SettingsPage>;
}
