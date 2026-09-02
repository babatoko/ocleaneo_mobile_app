import { describe, expect, it, beforeEach, vi } from 'vitest';

let store: Record<string, string> = {};

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store[key] ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store[key] = value;
    },
  },
}));

const { hasTourBeenSeen, markTourSeen } = await import('../onboarding');

beforeEach(() => {
  store = {};
});

describe('hasTourBeenSeen / markTourSeen', () => {
  it("n'a rien vu pour un employé qui ne s'est jamais connecté", async () => {
    expect(await hasTourBeenSeen(42)).toBe(false);
  });

  it('mémorise le tour vu pour un employé donné', async () => {
    await markTourSeen(42);
    expect(await hasTourBeenSeen(42)).toBe(true);
  });

  it("ne mélange pas les employés d'un même appareil partagé", async () => {
    await markTourSeen(42);
    expect(await hasTourBeenSeen(7)).toBe(false);
  });
});
