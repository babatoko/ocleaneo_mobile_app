import { Preferences } from '@capacitor/preferences';

const KEY_PREFIX = 'ocleaneo_tour_seen_';

/**
 * Namespacé par employé (voir types/models.ts) : sur un appareil partagé par
 * une équipe, le tour ne doit pas se déclencher — ni rester définitivement
 * masqué — pour la mauvaise personne.
 */
export async function hasTourBeenSeen(employeeId: number): Promise<boolean> {
  const { value } = await Preferences.get({ key: KEY_PREFIX + employeeId });
  return value === 'true';
}

/** Appelé une fois le tour terminé OU passé — jamais à mi-parcours, pour
 *  qu'une connexion interrompue ne prive pas l'employé du tour au retour. */
export async function markTourSeen(employeeId: number): Promise<void> {
  await Preferences.set({ key: KEY_PREFIX + employeeId, value: 'true' });
}
