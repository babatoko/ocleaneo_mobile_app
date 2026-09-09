import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '../auth';
import { provider } from '../../providers';

vi.mock('../../providers', () => ({
  provider: {
    changePassword: vi.fn(),
  },
}));

vi.mock('../../services/tokenStore', () => ({
  currentToken: vi.fn(() => null),
  saveToken: vi.fn(),
  clearToken: vi.fn(),
}));

describe('auth.changePassword', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('appelle provider.changePassword puis se déconnecte', async () => {
    const auth = useAuthStore();
    auth.token = 'token-fake';
    auth.employee = { id: 1, name: 'Test' };
    vi.mocked(provider.changePassword).mockResolvedValueOnce(undefined);

    await auth.changePassword('OldPassw0rd!!', 'NewPassw0rd!!');

    expect(provider.changePassword).toHaveBeenCalledWith('OldPassw0rd!!', 'NewPassw0rd!!');
    expect(auth.token).toBeNull();
    expect(auth.employee).toBeNull();
  });

  it('propage une erreur du provider', async () => {
    const auth = useAuthStore();
    vi.mocked(provider.changePassword).mockRejectedValueOnce(new Error('Mot de passe actuel incorrect'));

    await expect(auth.changePassword('bad', 'NewPassw0rd!!')).rejects.toThrow('Mot de passe actuel incorrect');
  });
});
