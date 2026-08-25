import { RestProvider } from './RestProvider';
import { MockProvider } from './MockProvider';
import type { DataProvider } from './DataProvider';

// Point d'entrée unique de la couche données : stores et vues importent
// `provider` d'ici, jamais un provider concret directement. Basculer de
// backend (ou tester sans backend) ne demande de changer qu'une variable
// d'environnement — voir README § Architecture backend-agnostique.
const factories: Record<string, () => DataProvider> = {
  rest: () => new RestProvider(),
  mock: () => new MockProvider(),
};

const selected = import.meta.env.VITE_DATA_PROVIDER || 'rest';
const factory = factories[selected] || factories.rest;

export const provider: DataProvider = factory();

/** À appeler une fois au démarrage (voir main.ts), avant tout appel de données. */
export function initProvider(): Promise<void> {
  return provider.init();
}

export { DataProvider, ProviderError, ProviderNetworkError } from './DataProvider';
