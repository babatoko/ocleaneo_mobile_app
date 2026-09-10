import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { IonContent, IonIcon, IonItem, IonLabel, IonList, IonNote, IonPage, IonToggle } from '@ionic/vue';
import { IonicVue } from '@ionic/vue';
import { nextTick } from 'vue';
import ProfileView from '../../views/ProfileView.vue';

const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('../../services/appInfo', () => ({
  getAppVersion: vi.fn(() => Promise.resolve('2.4.0')),
}));

vi.mock('../../services/biometric', () => ({
  isBiometricAvailable: vi.fn(() => Promise.resolve(false)),
  hasSavedCredentials: vi.fn(() => Promise.resolve(false)),
  clearSavedCredentials: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/notifications', () => ({
  areNotificationsEnabled: vi.fn(() => Promise.resolve(true)),
  setNotificationsEnabled: vi.fn(() => Promise.resolve()),
  cancelAllNotifications: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/offlineQueue', () => ({
  queueLength: vi.fn(() => Promise.resolve(0)),
  failedCount: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('../../services/errorLog', () => ({
  errorCount: vi.fn(() => Promise.resolve(0)),
  isTraceModeEnabled: vi.fn(() => Promise.resolve(false)),
  setTraceModeEnabled: vi.fn(() => Promise.resolve()),
  shareErrorLog: vi.fn(() => Promise.resolve()),
  clearErrorLog: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../composables/useProviderKind', () => ({
  PROVIDER_KIND_LABELS: { odoo: 'Odoo' },
  useProviderKind: () => ({ providerKind: { value: 'odoo' } }),
}));

const { useAuthStore } = await import('../../stores/auth');
const { setNotificationsEnabled } = await import('../../services/notifications');

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

const plugins = [IonicVue];
const ionicComponents = {
  IonPage,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonToggle,
};

async function mountProfile() {
  const wrapper = mount(ProfileView, {
    global: { plugins, components: ionicComponents },
  });
  await nextTick();
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  return wrapper;
}

describe('ProfileView', () => {
  it('affiche le nom et les initiales de l’employé', async () => {
    const auth = useAuthStore();
    auth.employee = { id: 1, name: 'Marie Dupont' };
    const wrapper = await mountProfile();
    expect(wrapper.text()).toContain('Marie Dupont');
    expect(wrapper.text()).toContain('MD');
  });

  it('affiche le fallback quand aucun employé n’est chargé', async () => {
    const wrapper = await mountProfile();
    expect(wrapper.text()).toContain('Salarié');
  });

  it('passe de l’état de chargement à l’affichage des préférences', async () => {
    const wrapper = await mountProfile();
    expect(wrapper.html()).toContain('Notifications');
  });

  it('appelle le service de notification quand le toggle est actionné', async () => {
    const wrapper = await mountProfile();
    const toggles = wrapper.findAllComponents(IonToggle);
    expect(toggles.length).toBeGreaterThan(0);
    toggles[0].vm.$emit('ionChange');
    await nextTick();
    expect(setNotificationsEnabled).toHaveBeenCalledWith(false);
  });

  it('contient un lien vers la page de sécurité', async () => {
    const wrapper = await mountProfile();
    const securityRow = wrapper.findAll('.grouped-row').find((el) =>
      el.html().includes('Sécurité')
    );
    expect(securityRow).toBeDefined();
    expect(securityRow?.attributes('routerlink')).toBe('/securite');
  });

  it('déconnecte l’utilisateur au clic sur le bouton de déconnexion', async () => {
    const auth = useAuthStore();
    auth.token = 'token-fake';
    auth.employee = { id: 1, name: 'Marie Dupont' };
    const wrapper = await mountProfile();
    await wrapper.find('.logout-btn').trigger('click');
    expect(auth.isAuthenticated).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});
