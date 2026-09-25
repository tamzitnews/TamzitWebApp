import { defineStrings } from '@/lib/i18n';

export const SavedStrings = defineStrings({
  he: {
    title: 'שמורים',
    remove: 'הסרה',
    count: (n: number) => (n === 1 ? 'ידיעה אחת' : `${n} ידיעות`),
    emptyTitle: 'עוד לא שמרתם ידיעות',
    emptyText: 'לחצו על הסימנייה בידיעה כדי לשמור אותה לקריאה מאוחרת',
    offline: 'אין חיבור. מוצגים השמורים ששמרנו במכשיר.',
    error: 'לא הצלחנו לטעון את השמורים. בדקו את החיבור ונסו שוב.',
    retry: 'נסו שוב',
  },
  en: {
    title: 'Saved',
    remove: 'Remove',
    count: (n: number) => (n === 1 ? '1 item' : `${n} items`),
    emptyTitle: "You haven't saved any items yet",
    emptyText: 'Tap the bookmark on an item to keep it for later',
    offline: 'No connection. Showing the saved items stored on this device.',
    error: "We couldn't load your saved items. Check your connection and try again.",
    retry: 'Try again',
  },
  fr: {
    title: 'Enregistrés',
    remove: 'Retirer',
    count: (n: number) => (n === 1 ? '1 article' : `${n} articles`),
    emptyTitle: "Vous n'avez encore enregistré aucun article",
    emptyText: "Touchez le signet d'un article pour le garder et le lire plus tard",
    offline: 'Pas de connexion. Affichage des articles enregistrés sur cet appareil.',
    error: 'Impossible de charger vos articles enregistrés. Vérifiez votre connexion et réessayez.',
    retry: 'Réessayer',
  },
});
