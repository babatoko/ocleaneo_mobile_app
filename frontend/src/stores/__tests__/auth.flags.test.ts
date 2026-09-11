import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { isModuleActive } from '../auth';
import type { MobileModuleFlag } from '../../types/models';

/**
 * Feature flags côté store : stockage des `modules` renvoyés par le backend
 * (login + fetchMe), résolution isModuleActive, effacement à la déconnexion.
 * Le backend est le seul verrou réel : ici on ne teste que ce que l'app
 * affiche ou masque.
 */

const provider = vi.hoisted(() => ({
  login: vi.fn(),
  fetchMe: vi.fn(),
}));

vi.mock('../../providers', () => ({ provider }));

let stored: string | null = null;

vi.mock('../../services/tokenStore', () => ({
  currentToken: () => stored,
  saveToken: vi.fn(async (t: string) => {
    stored = t;
  }),
  clearToken: vi.fn(async () => {
    stored = null;
  }),
}));

const { saveToken, clearToken } = await import('../../services/tokenStore');

const employee = { id: 7, name: 'Awa Diallo' };

function flag(tech: string, isActive = true): MobileModuleFlag {
  return {
    technical_name: tech,
    label: tech,
    icon: 'apps',
    route_path: null,
    is_active: isActive,
    requires_role: 'all',
    phase: 'mvp',
    offline_capable: false,
    settings: '{}',
  };
}

beforeEach(() => {
  stored = null;
  provider.login.mockReset();
  provider.fetchMe.mockReset();
  vi.mocked(saveToken).mockClear();
  vi.mocked(clearToken).mockClear();
  setActivePinia(createPinia());
});

async function store() {
  const { useAuthStore } = await import('../auth');
  return useAuthStore();
}

describe('isModuleActive', () => {
  it('true quand le flag est présent et actif', () => {
    expect(isModuleActive([flag('ocleaneo_tag_commissioning')], 'ocleaneo_tag_commissioning')).toBe(true);
  });

  it('false quand le flag est absent', () => {
    expect(isModuleActive([], 'ocleaneo_tag_commissioning')).toBe(false);
  });

  it('false quand le flag est présent mais inactif', () => {
    expect(
      isModuleActive([flag('ocleaneo_tag_commissioning', false)], 'ocleaneo_tag_commissioning'),
    ).toBe(false);
  });
});

describe('flags dans le store auth', () => {
  it('login stocke les modules renvoyés par le backend', async () => {
    const auth = await store();
    provider.login.mockResolvedValue({
      token: 'tok',
      employee,
      modules: [flag('ocleaneo_tag_commissioning')],
    });
    await auth.login('a@b', 'pw');
    expect(auth.modules).toHaveLength(1);
    expect(auth.modules[0].technical_name).toBe('ocleaneo_tag_commissioning');
  });

  it('login sans modules (ancien backend) laisse la liste vide', async () => {
    const auth = await store();
    provider.login.mockResolvedValue({ token: 'tok', employee });
    await auth.login('a@b', 'p');
    expect(auth.modules).toEqual([]);
  });

  it('fetchMe rafraîchit les flags (changement de ciblage au démarrage à froid)', async () => {
    const auth = await store();
    stored = 'tok';
    provider.login.mockResolvedValue({ token: 'tok', employee, modules: [] });
    await auth.login('a@b', 'p');
    provider.fetchMe.mockResolvedValue({
      employee,
      modules: [flag('ocleaneo_tag_commissioning')],
    });
    await auth.fetchMe();
    expect(isModuleActive(auth.modules, 'ocleaneo_tag_commissioning')).toBe(true);
  });

  it('logout vide les modules', async () => {
    const auth = await store();
    provider.login.mockResolvedValue({
      token: 'tok',
      employee,
      modules: [flag('ocleaneo_tag_commissioning')],
    });
    await auth.login('a@b', 'p');
    auth.logout();
    expect(auth.modules).toEqual([]);
  });
});