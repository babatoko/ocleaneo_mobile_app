import { ref } from 'vue';
import { Preferences } from '@capacitor/preferences';
import { RestProvider } from './RestProvider';
import { OdooProvider } from './OdooProvider';
import { MockProvider } from './MockProvider';
import type { DataProvider } from './DataProvider';

export type ProviderKind = 'rest' | 'odoo' | 'mock';

// Point d'entrée unique de la couche données : stores et vues importent
// `provider` d'ici, jamais un provider concret directement. Choisir un
// backend au build (VITE_DATA_PROVIDER) reste possible — voir README §
// Architecture backend-agnostique — mais LoginView.vue/ProfileView.vue
// permettent aussi de basculer à l'exécution (voir setProviderKind
// ci-dessous), pour un salarié dont l'app n'a jamais été construite avec
// le bon provider.
const factories: Record<ProviderKind, () => DataProvider> = {
  rest: () => new RestProvider(),
  odoo: () => new OdooProvider(),
  mock: () => new MockProvider(),
};

function isProviderKind(value: string): value is ProviderKind {
  return value in factories;
}

const PROVIDER_KIND_PREF_KEY = 'ocleaneo_data_provider';
const envProviderKind = import.meta.env.VITE_DATA_PROVIDER || '';
export const DEFAULT_PROVIDER_KIND: ProviderKind = isProviderKind(envProviderKind) ? envProviderKind : 'odoo';

/**
 * Réactif (contrairement à `provider` lui-même, une simple liaison ESM) :
 * useProviderKind.ts s'appuie dessus pour que l'écran de configuration
 * suive un changement de backend sans rechargement de page.
 */
export const providerKind = ref<ProviderKind>(DEFAULT_PROVIDER_KIND);

// `provider` est réassigné par setProviderKind() ci-dessous — une liaison
// ESM nommée (`import { provider } from '../providers'`) reste à jour après
// réassignation, donc tout le reste de l'app peut continuer à écrire
// `provider.xxx()` sans jamais capturer l'instance dans une variable locale.
export let provider: DataProvider = factories[providerKind.value]();

/** À appeler une fois au démarrage (voir main.ts), avant tout appel de données. */
export async function initProvider(): Promise<void> {
  const { value } = await Preferences.get({ key: PROVIDER_KIND_PREF_KEY });
  if (value && isProviderKind(value)) {
    providerKind.value = value;
    provider = factories[value]();
  }
  await provider.init();
}

/**
 * Change de backend à l'exécution, sans reconstruire l'app — même logique
 * que setServerUrl (composables/useServerUrl.ts) côté URL : persiste le
 * choix (@capacitor/preferences), recrée le provider concret et applique sa
 * config déjà enregistrée (chaque backend garde sa propre URL, voir
 * odooClient.ts/restClient.ts). Un jeton de session n'a aucun sens sur un
 * autre backend ; comme pour setServerUrl, la déconnexion reste à la charge
 * de l'appelant (ProfileView.vue s'en charge, LoginView.vue n'a rien à clore).
 */
export async function setProviderKind(kind: ProviderKind): Promise<void> {
  providerKind.value = kind;
  provider = factories[kind]();
  await Preferences.set({ key: PROVIDER_KIND_PREF_KEY, value: kind });
  await provider.init();
}

export { DataProvider, ProviderError, ProviderNetworkError } from './DataProvider';
