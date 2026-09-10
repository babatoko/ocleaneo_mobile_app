import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import PlanningView from '../PlanningView.vue';
import {
  IonBadge,
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonChip,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
} from '@ionic/vue';

const mockPush = vi.fn();
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router');
  return {
    ...actual,
    useRouter: () => ({ push: mockPush }),
  };
});

vi.mock('../../services/osrm', () => ({
  getCurrentPosition: vi.fn(() => Promise.resolve({ latitude: 0, longitude: 0 })),
  getOptimizedTrip: vi.fn(() => Promise.resolve({ duration: 0, distance: 0, points: [], stops: [] })),
  cacheTrip: vi.fn(),
  readCachedTrip: vi.fn(),
}));

vi.mock('../../services/offlineTileLayer', () => ({
  createOfflineTileLayer: vi.fn(() => null),
}));

vi.mock('../../services/calendarExport', () => ({
  exportShiftsToCalendar: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../providers', () => ({
  provider: {
    getDayShifts: vi.fn(() => Promise.resolve([])),
    getWeekShifts: vi.fn(() => Promise.resolve([])),
    getMonthShifts: vi.fn(() => Promise.resolve([])),
    getTournee: vi.fn(() => Promise.resolve([])),
  },
}));

const { useAuthStore } = await import('../../../stores/auth');

async function mountPlanning() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.employee = { id: 1, name: 'Marie Dubois' };
  auth.token = 'token';

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/planning', component: { template: '<div>Planning</div>' } }, { path: '/profil', component: { template: '<div>Profil</div>' } }],
  });
  await router.push('/planning');
  await router.isReady();

  const wrapper = mount(PlanningView, {
    global: { plugins: [IonicVue, pinia, router], components: {
      IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle,
      IonCardTitle, IonChip, IonContent, IonIcon, IonItem, IonLabel, IonList, IonPage,
      IonRefresher, IonRefresherContent, IonSegment, IonSegmentButton,
    }},
  });
  await nextTick();
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  return { wrapper, router };
}

describe('PlanningView header profile avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('affiche les initiales de l’agent dans le header', async () => {
    const { wrapper } = await mountPlanning();
    expect(wrapper.html()).toContain('MD');
    expect(wrapper.html()).toContain('avatar-btn');
  });

  it('navigue vers /profil quand on clique sur l’avatar', async () => {
    const { wrapper } = await mountPlanning();
    await wrapper.find('.avatar-btn').trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/profil');
  });
});
