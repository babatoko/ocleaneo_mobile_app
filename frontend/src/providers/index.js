import { RestProvider } from './RestProvider';
import { MockProvider } from './MockProvider';

// Point d'entrée unique de la couche données : stores et vues importent
// `provider` d'ici, jamais un provider concret directement. Basculer de
// backend (ou tester sans backend) ne demande de changer qu'une variable
// d'environnement — voir README § Architecture backend-agnostique.
const factories = {
  rest: () => new RestProvider(),
  mock: () => new MockProvider(),
};

const selected = import.meta.env.VITE_DATA_PROVIDER || 'rest';
const factory = factories[selected] || factories.rest;

export const provider = factory();

export { DataProvider, ProviderNetworkError } from './DataProvider';
