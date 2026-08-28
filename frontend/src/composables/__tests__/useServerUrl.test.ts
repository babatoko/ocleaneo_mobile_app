import { describe, expect, it, vi, beforeEach } from 'vitest';

// L'URL configurée mutable simule providers/odooClient.ts : un axios
// singleton dont .defaults.baseURL est modifié en place, pas remplacé par un
// nouvel objet — voir OdooProvider.ts/RestProvider.ts.
let stored: string | null = 'http://defaut.exemple/api';
const DEFAULT_URL = 'http://defaut.exemple/api';

vi.mock('../../providers', () => ({
  provider: {
    getDefaultServerUrl: () => DEFAULT_URL,
    getServerUrl: () => stored,
    setServerUrl: vi.fn(async (url: string) => {
      stored = url || DEFAULT_URL;
    }),
  },
}));

const { useServerUrl } = await import('../useServerUrl');

describe('useServerUrl', () => {
  beforeEach(() => {
    stored = DEFAULT_URL;
  });

  it('démarre avec la valeur actuelle du provider et sans erreur', () => {
    const s = useServerUrl();
    expect(s.serverUrlInput.value).toBe(DEFAULT_URL);
    expect(s.serverUrlError.value).toBe('');
    expect(s.showServerSetting).toBe(true);
    expect(s.serverUrlOverridden.value).toBe(false);
  });

  it("refuse une URL invalide sans appeler le provider", async () => {
    const s = useServerUrl();
    s.serverUrlInput.value = 'pas-une-url';
    const ok = await s.saveServerUrl();
    expect(ok).toBe(false);
    expect(s.serverUrlError.value).toMatch(/invalide/);
    expect(stored).toBe(DEFAULT_URL); // le provider n'a pas été touché
  });

  it('refuse un schéma non http(s)', async () => {
    const s = useServerUrl();
    s.serverUrlInput.value = 'ftp://exemple.com';
    const ok = await s.saveServerUrl();
    expect(ok).toBe(false);
  });

  it('enregistre une URL valide et met à jour currentServerUrl', async () => {
    const s = useServerUrl();
    s.serverUrlInput.value = 'https://client.example.com/api/mobile';
    const ok = await s.saveServerUrl();
    expect(ok).toBe(true);
    expect(stored).toBe('https://client.example.com/api/mobile');
    expect(s.currentServerUrl.value).toBe('https://client.example.com/api/mobile');
    expect(s.serverUrlOverridden.value).toBe(true);
    expect(s.serverUrlChanged.value).toBe(false); // input == valeur désormais courante
  });

  it('resetServerUrl revient à la valeur par défaut', async () => {
    const s = useServerUrl();
    s.serverUrlInput.value = 'https://client.example.com/api/mobile';
    await s.saveServerUrl();
    await s.resetServerUrl();
    expect(stored).toBe(DEFAULT_URL);
    expect(s.currentServerUrl.value).toBe(DEFAULT_URL);
    expect(s.serverUrlInput.value).toBe(DEFAULT_URL);
    expect(s.serverUrlOverridden.value).toBe(false);
  });

  it("ne déclenche jamais de déconnexion — cette responsabilité reste à l'appelant (ProfileView doit se déconnecter, LoginView non)", async () => {
    const s = useServerUrl();
    s.serverUrlInput.value = 'https://client.example.com/api/mobile';
    // Rien dans le composable n'importe stores/auth.ts ni vue-router ; le
    // simple fait que cet import réussisse sans mock d'auth/router est déjà
    // la preuve — on vérifie en plus qu'aucune fonction "logout" n'est
    // exposée par le composable.
    expect((s as Record<string, unknown>).logout).toBeUndefined();
    await s.saveServerUrl();
  });
});
