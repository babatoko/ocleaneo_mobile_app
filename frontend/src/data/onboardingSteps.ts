import { calendarOutline, cartOutline, personOutline, receiptOutline, timeOutline } from 'ionicons/icons';

export interface OnboardingStep {
  key: string;
  /** Chemin exact du RouterLink correspondant dans BottomNav.vue — sert à
   *  retrouver l'élément à mettre en lumière (voir OnboardingTour.vue). */
  route: string;
  icon: string;
  title: string;
  text: string;
}

/**
 * Source unique pour le tour guidé (OnboardingTour.vue) ET le manuel
 * d'utilisation (AideView.vue) : un seul texte par onglet à tenir à jour.
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: 'planning',
    route: '/planning',
    icon: calendarOutline,
    title: 'Planning',
    text: "Vos vacations du jour, de la semaine ou du mois. Glissez pour changer de période, pincez pour passer d'une vue à l'autre.",
  },
  {
    key: 'pointage',
    route: '/pointage',
    icon: timeOutline,
    title: 'Pointage',
    text: "Badgez au NFC du site en arrivant et en repartant. Un bandeau vous prévient si le GPS ou le NFC du téléphone semble désactivé — le pointage reste enregistré.",
  },
  {
    key: 'commande',
    route: '/commande/catalogue',
    icon: cartOutline,
    title: 'Commande',
    text: 'Parcourez le catalogue produits et constituez votre panier pour le prochain passage.',
  },
  {
    key: 'historique',
    route: '/historique',
    icon: receiptOutline,
    title: 'Historique',
    text: "Retrouvez vos commandes passées et leur état, du brouillon à la livraison.",
  },
  {
    key: 'profil',
    route: '/profil',
    icon: personOutline,
    title: 'Profil',
    text: "Vos réglages, et ce centre d'aide toujours accessible via le bouton « ? ».",
  },
];
