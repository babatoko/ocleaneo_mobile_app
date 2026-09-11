import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

/**
 * Écran TagCommissioningView : après un scan réussi, le numéro du tag est
 * affiché en grand + boutons série/terminer ; un badge déjà connu affiche le
 * bandeau « déjà enregistrée » ; un 403 renvoie au planning. Les composants
 * Ionic sont stubbés (leurs custom elements n'exposent pas textContent de
 * façon fiable sous happy-dom) — on asserte sur wrapper.html() et sur les
 * actions déclenchées, jamais sur .attributes('disabled') d'un ion-button.
 */

const provider = vi.hoisted(() => ({
  commissionTag: vi.fn(),
}));

// Chemins relatifs au FICHIER DE TEST (src/views/tag/__tests__/) — ils
// doivent résoudre exactement les modules que le composant importe depuis
// src/views/tag/, sinon vitest mocke un chemin fantôme et le composant
// continue d'utiliser le vrai provider.
vi.mock('../../../providers', () => ({ provider }));

const nfcMocks = vi.hoisted(() => ({
  onRead: vi.fn(async (_cb: unknown) => ({ remove: vi.fn() })),
}));

vi.mock('@exxili/capacitor-nfc', () => ({
  NFC: { onRead: nfcMocks.onRead },
}));

vi.mock('@capacitor/core', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core');
  // Plateforme native simulée : c'est la condition du composant pour
  // s'abonner à NFC.onRead — sans elle, aucun listener n'est posé.
  return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: () => true, getPlatform: () => 'android' } };
});

vi.mock('../../../services/nfc', () => ({
  isNfcSupported: vi.fn(async () => true),
  isNfcEnabled: vi.fn(async () => true),
  openNfcSettings: vi.fn(),
  startIosNfcSession: vi.fn(async () => {}),
}));

vi.mock('../../../services/haptics', () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticTap: vi.fn() }));
vi.mock('../../../services/errorLog', () => ({ recordError: vi.fn(async () => {}) }));

// Ionic stubs : éléments neutres qui rendent leurs slots.
const ionicStubs = {
  'ion-page': { template: '<div><slot /></div>' },
  'ion-content': { template: '<div><slot /></div>' },
  'ion-button': { template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  'ion-icon': { template: '<span />' },
  'ion-spinner': { template: '<span />' },
};

async function mountView() {
  const { default: TagCommissioningView } = await import('../TagCommissioningView.vue');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tag-commissioning', component: TagCommissioningView },
      { path: '/planning', component: { template: '<div />' } },
    ],
  });
  await router.push('/tag-commissioning');
  await router.isReady();
  // Espion posé AVANT le mount : le 403 déclenche router.replace pendant
  // onIonViewWillEnter (lancé juste après) — posé après, il ne verrait rien.
  const replaceSpy = vi.spyOn(router, 'replace');
  const wrapper = mount(TagCommissioningView, {
    global: {
      plugins: [createPinia(), router],
      stubs: ionicStubs,
    },
  });
  await flushPromises();
  // Le composant abonne son listener NFC dans onIonViewWillEnter, un hook
  // Ionic posé sur proxy['onIonViewWillEnter'] (voir @ionic/vue injectHook)
  // — déclencher ces hooks manuellement hors IonRouterOutlet pour que le
  // mock NFC.onRead soit appelé.
  const hooks = (wrapper.vm as unknown as Record<string, (() => void)[] | undefined>)['onIonViewWillEnter'];
  if (hooks) for (const h of hooks) h();
  await flushPromises();
  return { wrapper, router, replaceSpy };
}

beforeEach(() => {
  provider.commissionTag.mockReset();
  nfcMocks.onRead.mockClear();
  setActivePinia(createPinia());
});

describe('TagCommissioningView', () => {
  it('affiche le numéro du tag en grand après un scan réussi', async () => {
    provider.commissionTag.mockResolvedValue({
      id: 42, name: 'NFC00042', uid: '045A3B82F16C80', state: 'draft', existing: false, company_id: 1,
    });
    const { wrapper } = await mountView();
    // Simulation d'un événement NFC capté par l'abonnement onRead.
    const cb = nfcMocks.onRead.mock.calls[0][0] as (d: unknown) => void;
    cb({ string: () => ({ tagInfo: { uid: '04:5A:3B:82:F1:6C:80' } }) });
    await flushPromises();
    expect(provider.commissionTag).toHaveBeenCalledWith('045A3B82F16C80');
    expect(wrapper.html()).toContain('NFC00042');
    expect(wrapper.html()).toContain('Commissionner une autre pastille');
  });

  it('badge déjà connu : bandeau existant, pas de message de création', async () => {
    provider.commissionTag.mockResolvedValue({
      id: 17, name: 'NFC00017', uid: '041779C97800', state: 'draft', existing: true, company_id: 1,
    });
    const { wrapper } = await mountView();
    const cb = nfcMocks.onRead.mock.calls[0][0] as (d: unknown) => void;
    cb({ string: () => ({ tagInfo: { uid: '041779C97800' } }) });
    await flushPromises();
    expect(wrapper.html()).toContain('déjà enregistrée');
    expect(wrapper.html()).toContain('NFC00017');
  });

  it('403 : retour planning sans état d\'erreur', async () => {
    const { ProviderError } = await import('../../../providers/DataProvider');
    provider.commissionTag.mockRejectedValue(new ProviderError('feature not available', 403));
    const { wrapper, replaceSpy } = await mountView();
    const cb = nfcMocks.onRead.mock.calls[0][0] as (d: unknown) => void;
    cb({ string: () => ({ tagInfo: { uid: '04AA' } }) });
    await flushPromises();
    expect(replaceSpy).toHaveBeenCalledWith('/planning');
    expect(wrapper.html()).not.toContain('Échec de l');
  });

  it('erreur réseau : message explicite, retour en état scanner', async () => {
    const { ProviderNetworkError } = await import('../../../providers/DataProvider');
    provider.commissionTag.mockRejectedValue(new ProviderNetworkError());
    const { wrapper } = await mountView();
    const cb = nfcMocks.onRead.mock.calls[0][0] as (d: unknown) => void;
    cb({ string: () => ({ tagInfo: { uid: '04BB' } }) });
    await flushPromises();
    expect(wrapper.html()).toContain('Connexion requise');
  });
});