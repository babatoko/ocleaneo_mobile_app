import { describe, expect, it, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import { IonIcon, IonTabBar } from '@ionic/vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import BottomNav from '../../components/BottomNav.vue';

const routes = [
  { path: '/planning', component: { template: '<div>Planning</div>' } },
  { path: '/pointage', component: { template: '<div>Pointage</div>' } },
  { path: '/commande/catalogue', component: { template: '<div>Catalogue</div>' } },
  { path: '/historique', component: { template: '<div>Historique</div>' } },
  { path: '/profil', component: { template: '<div>Profil</div>' } },
];

async function mountBottomNav(initialPath = '/planning') {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(BottomNav, {
    global: { plugins: [IonicVue, router], components: { IonIcon, IonTabBar } },
  });
  await nextTick();
  await new Promise((r) => setTimeout(r, 10));
  await nextTick();
  return { wrapper, router };
}

describe('BottomNav', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('affiche 4 onglets sans onglet Profil', async () => {
    const { wrapper } = await mountBottomNav();
    const html = wrapper.html();
    expect(html).toContain('Planning');
    expect(html).toContain('Pointage');
    expect(html).toContain('Commande');
    expect(html).toContain('Historique');
    expect(html).not.toContain('Profil');
  });

  it('marque l’onglet courant comme actif', async () => {
    const { wrapper } = await mountBottomNav('/pointage');
    const active = wrapper.findAll('.nav-item.router-link-active');
    expect(active.length).toBe(1);
    expect(active[0].html()).toContain('Pointage');
  });
});
