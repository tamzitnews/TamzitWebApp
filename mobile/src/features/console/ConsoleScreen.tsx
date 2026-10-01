// "הודעות לקוראים": the operators' screen (Settings → הודעות לקוראים, shown only when app_me says is_operator).
// Writes one notification and sends it to the readers' devices through the app-push edge function, which checks the
// same list of operators (app_settings.console_admin_emails). The screen shows who would get it now, the message as
// it will look on the phone, and what was sent before.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Send } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ErrorState, Icon, Loading, Segmented, SwitchRow, T, TextField } from '@/components/ui';
import { ConfirmSheet, SettingsPage } from '@/features/settings/components';
import { api } from '@/lib/api';
import { defineStrings, useStrings } from '@/lib/i18n';
import type { ConsoleOverview } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const S = defineStrings({
  he: {
    title: 'הודעות לקוראים',
    note: 'ההודעה נשלחת כהתראה לכל מי שהתקין את האפליקציה. לחיצה עליה פותחת את האפליקציה.',
    audience: (n: number) => `${n} מכשירים יקבלו עכשיו`,
    resting: (n: number) => `${n} מכשירים לא יקבלו: אצלם שבת או חג.`,
    byLang: 'לפי שפה',
    langs: { he: 'עברית', en: 'אנגלית', fr: 'צרפתית', unknown: 'לא ידוע' } as Record<string, string>,
    headline: 'כותרת',
    headlineHint: 'השורה המודגשת בהתראה.',
    text: 'תוכן',
    textHint: 'עד כמה שורות. מה שלא נכנס נפתח בלחיצה ארוכה על ההתראה.',
    link: 'קישור',
    linkHint: 'לא חובה. מופיע בסוף ההודעה כדי שאפשר יהיה להעתיק אותו.',
    optional: '(לא חובה)',
    to: 'למי',
    toAll: 'לכולם',
    skipShabbat: 'לדלג על מי שבשבת או בחג',
    skipShabbatHint: 'מומלץ. בלי זה תישלח התראה גם למי שכבר נכנס לשבת.',
    preview: 'איך זה ייראה',
    previewApp: 'תמצית החדשות · עכשיו',
    previewTitle: 'תמצית החדשות',
    previewText: 'כאן יופיע תוכן ההודעה',
    send: 'שליחה',
    confirmTitle: (n: number) => `לשלוח ל־${n} מכשירים?`,
    confirmText: 'ההתראה תגיע מיד. אי אפשר לבטל אחרי השליחה.',
    confirm: 'שליחה',
    cancel: 'ביטול',
    sent: (n: number, of: number) => `נשלח ל־${n} מתוך ${of} מכשירים.`,
    history: 'מה נשלח',
    historyEmpty: 'עוד לא נשלחה הודעה.',
    historyCount: (n: number, of: number) => `${n} מתוך ${of}`,
    needText: 'צריך לכתוב תוכן להודעה.',
    badUrl: 'הקישור צריך להתחיל ב־https://',
    failed: 'לא הצלחנו לשלוח. אפשר לנסות שוב.',
    notOperator: 'החשבון הזה לא מורשה לשלוח הודעות.',
    loadError: 'לא הצלחנו לטעון את הנתונים.',
    retry: 'נסו שוב',
  },
  en: {
    title: 'Messages to readers',
    note: 'The message is sent as a notification to everyone who installed the app. Tapping it opens the app.',
    audience: (n: number) => `${n} devices will get it now`,
    resting: (n: number) => `${n} devices will not: it is Shabbat or a holiday there.`,
    byLang: 'By language',
    langs: { he: 'Hebrew', en: 'English', fr: 'French', unknown: 'Unknown' } as Record<string, string>,
    headline: 'Title',
    headlineHint: 'The bold line of the notification.',
    text: 'Message',
    textHint: 'A few lines. The rest opens on a long press.',
    link: 'Link',
    linkHint: 'Optional. Shown at the end so it can be copied.',
    optional: '(optional)',
    to: 'To',
    toAll: 'Everyone',
    skipShabbat: 'Skip readers in Shabbat or a holiday',
    skipShabbatHint: 'Recommended. Without it they get a notification too.',
    preview: 'How it will look',
    previewApp: 'Tamzit News · now',
    previewTitle: 'Tamzit News',
    previewText: 'The message will appear here',
    send: 'Send',
    confirmTitle: (n: number) => `Send to ${n} devices?`,
    confirmText: 'It arrives right away and cannot be taken back.',
    confirm: 'Send',
    cancel: 'Cancel',
    sent: (n: number, of: number) => `Sent to ${n} of ${of} devices.`,
    history: 'Sent before',
    historyEmpty: 'Nothing sent yet.',
    historyCount: (n: number, of: number) => `${n} of ${of}`,
    needText: 'Write the message first.',
    badUrl: 'The link must start with https://',
    failed: "We couldn't send it. Try again.",
    notOperator: 'This account may not send messages.',
    loadError: "We couldn't load the data.",
    retry: 'Try again',
  },
  fr: {
    title: 'Messages aux lecteurs',
    note: "Le message arrive comme notification à tous ceux qui ont installé l'application.",
    audience: (n: number) => `${n} appareils le recevront`,
    resting: (n: number) => `${n} appareils ne le recevront pas : Chabbat ou fête.`,
    byLang: 'Par langue',
    langs: { he: 'Hébreu', en: 'Anglais', fr: 'Français', unknown: 'Inconnu' } as Record<string, string>,
    headline: 'Titre',
    headlineHint: 'La ligne en gras de la notification.',
    text: 'Message',
    textHint: "Quelques lignes. Le reste s'ouvre par un appui long.",
    link: 'Lien',
    linkHint: 'Facultatif. Affiché à la fin pour être copié.',
    optional: '(facultatif)',
    to: 'À qui',
    toAll: 'Tout le monde',
    skipShabbat: 'Ignorer ceux en Chabbat ou en fête',
    skipShabbatHint: 'Recommandé.',
    preview: 'Aperçu',
    previewApp: "L'essentiel de l'actualité · maintenant",
    previewTitle: "L'essentiel de l'actualité",
    previewText: 'Le message apparaîtra ici',
    send: 'Envoyer',
    confirmTitle: (n: number) => `Envoyer à ${n} appareils ?`,
    confirmText: 'La notification part tout de suite et ne peut pas être annulée.',
    confirm: 'Envoyer',
    cancel: 'Annuler',
    sent: (n: number, of: number) => `Envoyé à ${n} sur ${of} appareils.`,
    history: 'Déjà envoyé',
    historyEmpty: 'Rien pour le moment.',
    historyCount: (n: number, of: number) => `${n} sur ${of}`,
    needText: "Écrivez d'abord le message.",
    badUrl: 'Le lien doit commencer par https://',
    failed: "L'envoi a échoué. Réessayez.",
    notOperator: "Ce compte ne peut pas envoyer de messages.",
    loadError: 'Chargement impossible.',
    retry: 'Réessayer',
  },
});

type Lang = '' | 'he' | 'en' | 'fr';

/** The notification as the phone shows it: app line, bold title, the text with the link under it. */
function Preview({ title, text, url, labels }: { title: string; text: string; url: string; labels: { app: string; title: string; text: string } }) {
  const { c } = useTheme();
  return (
    <View style={{ backgroundColor: c.surfaceHero, borderRadius: radius.lg, padding: space[3] }}>
      <View style={{ backgroundColor: c.surfaceRaised, borderRadius: radius.md, padding: space[3], flexDirection: 'row', gap: space[3] }}>
        <View style={{ width: 28, height: 28, borderRadius: radius.md, backgroundColor: c.surfaceTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon as={Megaphone} size={15} color="brand" />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T variant="caption" color="inkMuted">
            {labels.app}
          </T>
          <T variant="label" weight={600}>
            {title.trim() || labels.title}
          </T>
          <T variant="caption" color="inkMuted">
            {(text.trim() || labels.text) + (url.trim() ? `\n${url.trim()}` : '')}
          </T>
        </View>
      </View>
    </View>
  );
}

export function ConsoleScreen() {
  const s = useStrings(S);
  const { c } = useTheme();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState<Lang>('');
  const [skipShabbat, setSkipShabbat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const overview = useQuery<ConsoleOverview>({ queryKey: ['console'], queryFn: () => api.consoleOverview(), staleTime: 30_000 });

  const send = useMutation({
    mutationFn: () =>
      api.sendMessage({ title: title.trim(), body: text.trim(), url: url.trim(), language: lang, skip_shabbat: skipShabbat }),
    onSuccess: (r) => {
      setConfirming(false);
      setDone(s.sent(r.sent, r.devices));
      setText('');
      setUrl('');
      qc.invalidateQueries({ queryKey: ['console'] });
    },
    onError: (e: { message?: string }) => {
      setConfirming(false);
      setError(e?.message === 'not_an_operator' ? s.notOperator : s.failed);
    },
  });

  if (overview.isLoading) {
    return (
      <SettingsPage title={s.title}>
        <Loading />
      </SettingsPage>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <SettingsPage title={s.title}>
        <ErrorState message={s.loadError} onRetry={() => overview.refetch()} retryLabel={s.retry} />
      </SettingsPage>
    );
  }

  const data = overview.data;
  const reach = skipShabbat ? data.awake : data.devices;

  const review = () => {
    setDone(null);
    if (!text.trim()) {
      setError(s.needText);
      return;
    }
    if (url.trim() && !/^https?:\/\//.test(url.trim())) {
      setError(s.badUrl);
      return;
    }
    setError(null);
    setConfirming(true);
  };

  return (
    <SettingsPage title={s.title} note={s.note}>
      <Card tone="tint">
        <T variant="headline">{s.audience(reach)}</T>
        <T variant="caption" color="inkMuted">
          {Object.entries(data.by_language)
            .map(([k, n]) => `${s.langs[k] ?? k}: ${n}`)
            .join(' · ')}
        </T>
        {skipShabbat && data.resting > 0 ? (
          <T variant="caption" color="inkMuted">
            {s.resting(data.resting)}
          </T>
        ) : null}
      </Card>

      <TextField label={s.headline} hint={s.headlineHint} value={title} onChangeText={setTitle} maxLength={100} placeholder={s.previewTitle} />
      <TextField
        label={s.text}
        hint={s.textHint}
        value={text}
        onChangeText={setText}
        maxLength={500}
        multiline
        style={{ minHeight: 110, paddingTop: space[3], textAlignVertical: 'top' }}
      />
      <TextField label={s.link} hint={s.linkHint} optional={s.optional} value={url} onChangeText={setUrl} ltr autoCapitalize="none" keyboardType="url" placeholder="https://" />

      <Segmented<Lang>
        legend={s.to}
        value={lang}
        onChange={setLang}
        options={[
          { value: '', label: s.toAll },
          { value: 'he', label: s.langs.he },
          { value: 'en', label: s.langs.en },
          { value: 'fr', label: s.langs.fr },
        ]}
      />

      <SwitchRow label={s.skipShabbat} description={s.skipShabbatHint} value={skipShabbat} onValueChange={setSkipShabbat} />

      <View style={{ gap: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.preview}
        </T>
        <Preview title={title} text={text} url={url} labels={{ app: s.previewApp, title: s.previewTitle, text: s.previewText }} />
      </View>

      {error ? (
        <T variant="caption" color="criticalInk">
          {error}
        </T>
      ) : null}
      {done ? (
        <T variant="caption" color="good">
          {done}
        </T>
      ) : null}

      <Button icon={Send} onPress={review} loading={send.isPending} block>
        {s.send}
      </Button>

      <View style={{ gap: space[3], marginTop: space[2] }}>
        <T variant="caption" color="inkMuted" weight={600}>
          {s.history}
        </T>
        {data.history.length === 0 ? (
          <T variant="caption" color="inkMuted">
            {s.historyEmpty}
          </T>
        ) : (
          data.history.map((h) => (
            <View key={h.id} style={{ borderStartWidth: 3, borderStartColor: c.surfaceTint, paddingStart: space[3], gap: 2 }}>
              <T variant="caption" color="inkMuted">
                {new Date(h.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {' · '}
                {s.historyCount(h.sent, h.devices)}
              </T>
              <T variant="label" weight={600}>
                {h.title}
              </T>
              <T variant="caption" color="inkMuted">
                {h.body}
              </T>
            </View>
          ))
        )}
      </View>

      <ConfirmSheet
        visible={confirming}
        title={s.confirmTitle(reach)}
        text={s.confirmText}
        confirm={s.confirm}
        cancel={s.cancel}
        loading={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </SettingsPage>
  );
}
