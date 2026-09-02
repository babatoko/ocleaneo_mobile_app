import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ONBOARDING_STEPS } from '../../data/onboardingSteps';

/**
 * Le store n'a besoin que de employee.id — le mock reste un objet simple
 * plutôt que le vrai store d'authentification, pour ne dépendre ni de
 * providers/ ni de services/tokenStore.ts (déjà couverts par auth.test.ts).
 */
const authState: { employee: { id: number; name: string } | null } = { employee: null };
vi.mock('../auth', () => ({ useAuthStore: () => authState }));

const hasTourBeenSeen = vi.fn();
const markTourSeen = vi.fn();
vi.mock('../../services/onboarding', () => ({
  hasTourBeenSeen: (id: number) => hasTourBeenSeen(id),
  markTourSeen: (id: number) => markTourSeen(id),
}));

beforeEach(() => {
  authState.employee = null;
  hasTourBeenSeen.mockReset();
  markTourSeen.mockReset().mockResolvedValue(undefined);
  setActivePinia(createPinia());
});

async function store() {
  const { useOnboardingStore } = await import('../onboarding');
  return useOnboardingStore();
}

describe('store onboarding', () => {
  it('ne démarre pas tant que l’employé courant est inconnu', async () => {
    const s = await store();
    await s.maybeStartForCurrentEmployee();
    expect(s.active).toBe(false);
    expect(hasTourBeenSeen).not.toHaveBeenCalled();
  });

  it('démarre le tour pour un employé qui ne l’a jamais vu', async () => {
    authState.employee = { id: 42, name: 'Awa Diallo' };
    hasTourBeenSeen.mockResolvedValue(false);
    const s = await store();

    await s.maybeStartForCurrentEmployee();

    expect(hasTourBeenSeen).toHaveBeenCalledWith(42);
    expect(s.active).toBe(true);
    expect(s.step).toBe(0);
  });

  it('ne redémarre pas pour un employé qui l’a déjà vu', async () => {
    authState.employee = { id: 42, name: 'Awa Diallo' };
    hasTourBeenSeen.mockResolvedValue(true);
    const s = await store();

    await s.maybeStartForCurrentEmployee();

    expect(s.active).toBe(false);
  });

  it('avance étape par étape puis termine et marque le drapeau', async () => {
    authState.employee = { id: 42, name: 'Awa Diallo' };
    const s = await store();
    s.start();

    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      s.next();
      expect(s.step).toBe(i);
    }
    expect(s.active).toBe(true);

    s.next(); // dernière étape -> termine tout seul
    expect(s.active).toBe(false);
    expect(markTourSeen).toHaveBeenCalledWith(42);
  });

  it('passer marque aussi le drapeau, à mi-parcours', async () => {
    authState.employee = { id: 42, name: 'Awa Diallo' };
    const s = await store();
    s.start();
    s.next();

    await s.finish();

    expect(s.active).toBe(false);
    expect(markTourSeen).toHaveBeenCalledWith(42);
  });

  it('prev recule sans jamais descendre sous la première étape', async () => {
    authState.employee = { id: 42, name: 'Awa Diallo' };
    const s = await store();
    s.start();
    s.prev();
    expect(s.step).toBe(0);
  });

  it('start() ne redemande pas le drapeau — utilisé pour rejouer le tour', async () => {
    authState.employee = { id: 42, name: 'Awa Diallo' };
    const s = await store();

    s.start();

    expect(s.active).toBe(true);
    expect(hasTourBeenSeen).not.toHaveBeenCalled();
  });
});
