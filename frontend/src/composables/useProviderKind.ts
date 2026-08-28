import { ref } from 'vue';
import { DEFAULT_PROVIDER_KIND, providerKind, setProviderKind, type ProviderKind } from '../providers';

/**
 * Libellés affichés en face de chaque backend — voir providers/index.ts
 * pour ce que chaque valeur active réellement (RestProvider.ts n'a pas
 * d'instance de production en face aujourd'hui, voir README § Intégration
 * Odoo ; MockProvider.ts est 100 % en mémoire, pensé pour la démo hors
 * ligne plutôt qu'un usage réel).
 */
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  odoo: 'Odoo',
  rest: 'REST',
  mock: 'Démo (hors ligne)',
};

export const PROVIDER_KINDS: ProviderKind[] = ['odoo', 'rest', 'mock'];

/**
 * Sélection du backend actif à l'exécution — jusqu'ici figée au build par
 * VITE_DATA_PROVIDER (voir .env.example), sans aucun moyen de la corriger
 * depuis l'app une fois construite. `providerKind` est la même ref
 * réactive exportée par providers/index.ts : ce composable n'ajoute que la
 * mutation contrôlée (`selectProviderKind`) et son état de chargement.
 */
export function useProviderKind() {
  const savingProviderKind = ref(false);

  /** @returns true si le backend a réellement changé (false si `kind` était déjà actif). */
  async function selectProviderKind(kind: ProviderKind): Promise<boolean> {
    if (kind === providerKind.value) return false;
    savingProviderKind.value = true;
    try {
      await setProviderKind(kind);
    } finally {
      savingProviderKind.value = false;
    }
    return true;
  }

  return {
    providerKind,
    defaultProviderKind: DEFAULT_PROVIDER_KIND,
    savingProviderKind,
    selectProviderKind,
  };
}
