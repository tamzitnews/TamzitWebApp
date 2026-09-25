import { router } from 'expo-router';
import { CircleCheck, Flag, MessageCircleQuestion, ThumbsDown, ThumbsUp, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, Icon, IconButton, T, useIsRTL } from '@/components/ui';
import { api } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import { useItemStore } from '@/lib/itemStore';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, radius, space } from '@/theme/tokens';

const S = defineStrings({
  he: {
    title: 'משוב על הידיעה',
    close: 'סגירה',
    helpful: 'מועיל',
    notHelpful: 'לא מועיל',
    rated: 'תודה, המשוב נקלט.',
    error: 'דיווח על טעות',
    question: 'שאלה לעורכים',
    errorLabel: 'מה לא מדויק?',
    questionLabel: 'מה תרצו לשאול?',
    errorPh: 'כתבו לנו מה צריך לתקן, ואם אפשר גם מקור',
    questionPh: 'העורכים עונים בתוך יום עבודה',
    send: 'שליחה',
    sent: 'תודה, העורכים קיבלו',
    sentText: 'כשיתקנו או יענו, תקבלו הודעה באפליקציה.',
    failed: 'לא הצלחנו לשלוח. נסו שוב.',
  },
  en: {
    title: 'Feedback on this item',
    close: 'Close',
    helpful: 'Helpful',
    notHelpful: 'Not helpful',
    rated: 'Thanks, noted.',
    error: 'Report a mistake',
    question: 'Ask the editors',
    errorLabel: "What isn't accurate?",
    questionLabel: 'What would you like to ask?',
    errorPh: 'Tell us what needs fixing, and a source if you can',
    questionPh: 'The editors reply within a working day',
    send: 'Send',
    sent: 'Thanks, the editors have it',
    sentText: "When they correct or reply, you'll get a message in the app.",
    failed: "We couldn't send it. Please try again.",
  },
  fr: {
    title: 'Avis sur cet article',
    close: 'Fermer',
    helpful: 'Utile',
    notHelpful: 'Pas utile',
    rated: 'Merci, c’est noté.',
    error: 'Signaler une erreur',
    question: 'Question à la rédaction',
    errorLabel: "Qu'est-ce qui n'est pas exact ?",
    questionLabel: 'Que souhaitez-vous demander ?',
    errorPh: 'Dites-nous ce qu’il faut corriger, avec une source si possible',
    questionPh: 'La rédaction répond sous un jour ouvré',
    send: 'Envoyer',
    sent: 'Merci, la rédaction l’a reçu',
    sentText: 'Quand elle corrigera ou répondra, vous recevrez un message dans l’application.',
    failed: "L'envoi n'a pas fonctionné. Réessayez.",
  },
});

type Rate = 'helpful' | 'not_helpful';
type Kind = 'error' | 'question';

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)');
}

/**
 * `/feedback/[itemId]`: bottom sheet over the scrim. Helpful / not helpful is sent at once; a
 * mistake report or a question opens the text field and is sent with "שליחה".
 */
export function FeedbackSheet({ itemId }: { itemId: string }) {
  const { c } = useTheme();
  const s = useStrings(S);
  const insets = useSafeAreaInsets();
  const rtl = useIsRTL();
  const headline = useItemStore((st) => st.byId[itemId]?.headline);
  const [rate, setRate] = useState<Rate | null>(null);
  const [rateState, setRateState] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(close, 1800);
    return () => clearTimeout(t);
  }, [done]);

  const onRate = (r: Rate) => {
    if (rate === r && rateState === 'sent') return;
    setRate(r);
    setRateState('idle');
    api
      .submitFeedback(itemId, r)
      .then(() => setRateState('sent'))
      .catch(() => setRateState('failed'));
  };

  const onKind = (k: Kind) => {
    setKind(k);
    setFailed(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const onSend = async () => {
    if (!kind || !text.trim()) return;
    setSending(true);
    setFailed(false);
    try {
      await api.submitFeedback(itemId, kind, text.trim());
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.close}
        onPress={close}
        style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.surfaceRaised,
            borderTopStartRadius: radius.lg,
            borderTopEndRadius: radius.lg,
            paddingTop: space[3],
            paddingHorizontal: space[5],
            paddingBottom: Math.max(insets.bottom, space[2]) + space[4],
            shadowColor: '#021330',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: -6 },
            elevation: 16,
          }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.lineStrong, alignSelf: 'center', marginBottom: space[3] }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] }}>
            <View style={{ flex: 1 }}>
              <T variant="title" accessibilityRole="header">
                {s.title}
              </T>
              {headline ? (
                <T variant="caption" color="inkMuted" numberOfLines={1}>
                  {headline}
                </T>
              ) : null}
            </View>
            <View style={{ marginEnd: -10 }}>
              <IconButton icon={X} label={s.close} onPress={close} color="ink" />
            </View>
          </View>

          {done ? (
            <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: space[2], paddingVertical: space[6] }}>
              <Icon as={CircleCheck} size={44} color="good" strokeWidth={2} />
              <T variant="headline" align="center">
                {s.sent}
              </T>
              <T variant="caption" color="inkMuted" align="center">
                {s.sentText}
              </T>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', gap: space[3] }}>
                <Button
                  variant={rate === 'helpful' ? 'primary' : 'secondary'}
                  icon={ThumbsUp}
                  onPress={() => onRate('helpful')}
                  style={{ flex: 1 }}>
                  {s.helpful}
                </Button>
                <Button
                  variant={rate === 'not_helpful' ? 'primary' : 'secondary'}
                  icon={ThumbsDown}
                  onPress={() => onRate('not_helpful')}
                  style={{ flex: 1 }}>
                  {s.notHelpful}
                </Button>
              </View>
              <View style={{ minHeight: 20, marginTop: space[2], marginBottom: space[3] }} accessibilityLiveRegion="polite">
                {rateState === 'sent' ? (
                  <T variant="caption" color="inkMuted" align="center">
                    {s.rated}
                  </T>
                ) : rateState === 'failed' ? (
                  <T variant="caption" color="criticalInk" align="center">
                    {s.failed}
                  </T>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
                <Chip icon={Flag} label={s.error} selected={kind === 'error'} onPress={() => onKind('error')} />
                <Chip icon={MessageCircleQuestion} label={s.question} selected={kind === 'question'} onPress={() => onKind('question')} />
              </View>
              {kind ? (
                <View style={{ marginTop: space[4], gap: space[2] }}>
                  <T variant="caption" weight={600}>
                    {kind === 'error' ? s.errorLabel : s.questionLabel}
                  </T>
                  <TextInput
                    ref={inputRef}
                    value={text}
                    onChangeText={setText}
                    multiline
                    maxLength={1000}
                    accessibilityLabel={kind === 'error' ? s.errorLabel : s.questionLabel}
                    placeholder={kind === 'error' ? s.errorPh : s.questionPh}
                    placeholderTextColor={c.inkMuted}
                    textAlignVertical="top"
                    style={{
                      minHeight: 96,
                      maxHeight: 180,
                      padding: space[3],
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderColor: failed ? c.critical : c.lineStrong,
                      backgroundColor: c.surface,
                      color: c.ink,
                      fontFamily: fonts[400],
                      fontSize: 16,
                      lineHeight: 24,
                      textAlign: rtl ? 'right' : 'left',
                    }}
                  />
                  {failed ? (
                    <T variant="caption" color="criticalInk">
                      {s.failed}
                    </T>
                  ) : null}
                  <Button block size="lg" loading={sending} disabled={!text.trim()} onPress={onSend} style={{ marginTop: space[2] }}>
                    {s.send}
                  </Button>
                </View>
              ) : null}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
