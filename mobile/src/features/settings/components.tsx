// Building blocks shared by the settings screens: the page frame, the save footer and a dialog.
import { CircleAlert, Check } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar, Button, Icon, Loading, Screen, T } from '@/components/ui';
import { useStrings } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useProfileValues, type ProfileValues, type SaveState } from './hooks';
import { SETTINGS_S } from './strings';

/** A settings sub-screen: back button + title, scrolling content, optional footer. */
export function SettingsPage({
  title,
  subtitle,
  note,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  /** Short explanation under the title. */
  note?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      header={<AppBar back title={title} subtitle={subtitle} />}
      footer={footer}
      contentStyle={{ paddingTop: space[2], gap: space[4] }}>
      {note ? (
        <T variant="caption" color="inkMuted">
          {note}
        </T>
      ) : null}
      {children}
    </Screen>
  );
}

/**
 * Renders its children only once the reader's current values are known (server profile when
 * signed in), so a screen's local state starts from the real values.
 */
export function ValuesGate({ title, children }: { title: string; children: (values: ProfileValues) => ReactNode }) {
  const { values, ready } = useProfileValues();
  if (!ready)
    return (
      <SettingsPage title={title}>
        <Loading />
      </SettingsPage>
    );
  return <>{children(values)}</>;
}

/** Footer of a preference screen: when the change takes effect, and whether it was saved. */
export function SaveFooter({ note, state }: { note: string | null; state: SaveState }) {
  const { c } = useTheme();
  const s = useStrings(SETTINGS_S);
  const status =
    state === 'saving' ? s.saving : state === 'saved' ? s.saved : state === 'error' ? s.saveError : null;
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: c.line,
        backgroundColor: c.surface,
        paddingHorizontal: space[5],
        paddingVertical: space[3],
        gap: space[1],
      }}>
      {note ? (
        <T variant="caption" color="inkMuted">
          {note}
        </T>
      ) : null}
      {status ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] }}>
          {state === 'saved' ? <Icon as={Check} size={16} color="brand" strokeWidth={2.25} /> : null}
          {state === 'error' ? <Icon as={CircleAlert} size={16} color="criticalInk" /> : null}
          <T variant="caption" weight={600} color={state === 'error' ? 'criticalInk' : 'inkMuted'}>
            {status}
          </T>
        </View>
      ) : null}
    </View>
  );
}

/** Bottom sheet dialog (works on Android and web; no system Alert). */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel={title} onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: c.scrim }} />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.surfaceRaised,
            borderTopStartRadius: radius.lg,
            borderTopEndRadius: radius.lg,
            paddingHorizontal: space[5],
            paddingTop: space[3],
            paddingBottom: space[5] + insets.bottom,
            gap: space[4],
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -4 },
            elevation: 12,
          }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line }} />
          <T variant="title" accessibilityRole="header">
            {title}
          </T>
          {children}
          {actions ? <View style={{ gap: space[2] }}>{actions}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/** A confirmation sheet with a destructive (or primary) action and a cancel button. */
export function ConfirmSheet({
  visible,
  title,
  text,
  confirm,
  cancel,
  onConfirm,
  onCancel,
  loading,
}: {
  visible: boolean;
  title: string;
  text?: string;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button block size="lg" onPress={onConfirm} loading={loading}>
            {confirm}
          </Button>
          <Button block variant="quiet" onPress={onCancel}>
            {cancel}
          </Button>
        </>
      }>
      {text ? (
        <T variant="body" color="inkMuted">
          {text}
        </T>
      ) : null}
    </Sheet>
  );
}
