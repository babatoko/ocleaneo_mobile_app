import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Vérifie que la déconnexion efface bien toutes les données locales liées à
 * l'utilisateur courant, sans toucher aux paramètres globaux de l'application.
 */

let disk: Record<string, string> = {};

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    keys: vi.fn(async () => ({ keys: Object.keys(disk) })),
    get: vi.fn(async ({ key }: { key: string }) => ({ value: disk[key] ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      disk[key] = value;
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      delete disk[key];
    }),
  },
}));

vi.mock('@capgo/capacitor-native-biometric', () => ({
  NativeBiometric: {
    deleteCredentials: vi.fn(async () => {}),
  },
}));

vi.mock('../notifications', () => ({
  cancelAllNotifications: vi.fn(async () => {}),
}));

async function freshModule() {
  vi.resetModules();
  return import('../userDataCleanup');
}

beforeEach(() => {
  disk = {};
});

describe('clearUserPreferences', () => {
  it('efface les caches utilisateur mais garde les paramètres globaux', async () => {
    const { clearUserPreferences } = await freshModule();

    disk['ocleaneo_shifts_2026-08-05_2026-08-05'] = JSON.stringify([{ id: 1 }]);
    disk['ocleaneo_shifts_upcoming'] = JSON.stringify({ from: '2026-08-05', to: '2026-08-20', data: [] });
    disk['ocleaneo_chantiers_cache'] = JSON.stringify([{ id: 10 }]);
    disk['ocleaneo_pointage_offline_queue'] = JSON.stringify([{ localId: 'x' }]);
    disk['ocleaneo_pointage_pending_compte_rendu'] = JSON.stringify([{ clientRef: 'y' }]);
    disk['ocleaneo_pointage_failed_entries'] = JSON.stringify([{ reason: 'z' }]);
    disk['ocleaneo_tour_seen_42'] = 'true';

    // F02 (audit 13/09) : caches à données personnelles jamais purgés avant —
    // itinéraires OSRM (noms + adresses + coordonnées des chantiers) et
    // snapshot du planning (notes). Sur un appareil partagé, le salarié
    // suivant voyait la tournée du précédent.
    disk['ocleaneo_trip_2026-08-05_1,2,3'] = JSON.stringify({ distanceMeters: 1 });
    disk['ocleaneo_planning_snapshot'] = JSON.stringify({ note: 'planning privé' });

    // Paramètres globaux à conserver — les VRAIES clés (F04 : la liste
    // originale citait ocleaneo_server_url/ocleaneo_trace_mode, qui
    // n'existent nulle part ; les clés réelles sont celles-ci).
    disk['ocleaneo_api_base_url'] = 'https://api.example';
    disk['ocleaneo_odoo_api_base_url'] = 'https://odoo.example';
    disk['ocleaneo_data_provider'] = 'odoo';
    disk['ocleaneo_trace_mode_enabled'] = 'true';
    disk['ocleaneo_error_log'] = JSON.stringify([{ message: 'bug' }]);

    await clearUserPreferences();

    expect(disk['ocleaneo_shifts_2026-08-05_2026-08-05']).toBeUndefined();
    expect(disk['ocleaneo_shifts_upcoming']).toBeUndefined();
    expect(disk['ocleaneo_chantiers_cache']).toBeUndefined();
    expect(disk['ocleaneo_pointage_offline_queue']).toBeUndefined();
    expect(disk['ocleaneo_pointage_pending_compte_rendu']).toBeUndefined();
    expect(disk['ocleaneo_pointage_failed_entries']).toBeUndefined();
    expect(disk['ocleaneo_tour_seen_42']).toBeUndefined();
    expect(disk['ocleaneo_trip_2026-08-05_1,2,3']).toBeUndefined();
    expect(disk['ocleaneo_planning_snapshot']).toBeUndefined();

    expect(disk['ocleaneo_api_base_url']).toBe('https://api.example');
    expect(disk['ocleaneo_odoo_api_base_url']).toBe('https://odoo.example');
    expect(disk['ocleaneo_data_provider']).toBe('odoo');
    expect(disk['ocleaneo_trace_mode_enabled']).toBe('true');
    expect(disk['ocleaneo_error_log']).toBeTruthy();
  });

  it("F04 : une clé user-specific hors registre est signalée par le test d'exhaustivité", async () => {
    // Le registre STORED_KEYS est la seule source de vérité : une nouvelle
    // clé persistante oubliée fuierait au logout silencieusement (c'est
    // arrivé — F02). Ce test scanne les littéraux ocleaneo_* des sources
    // (via import.meta.glob de Vite, sans dépendre des types node) pour
    // détecter une clé absente du registre.
    const { STORED_KEYS, NON_STORAGE_LITERALS } = await freshModule();
    const known = new Set(STORED_KEYS.map((k: { key: string }) => k.key));
    const modules = import.meta.glob('../../**/*.{ts,vue}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const missing: string[] = [];
    for (const [file, text] of Object.entries(modules)) {
      if (file.includes('__tests__')) continue;
      for (const m of (text as string).matchAll(/'(ocleaneo_[a-z0-9_]+)'/g)) {
        const key = m[1];
        const registered = [...known].some(
          (k: string) => key === k || (key.startsWith(k) && k.endsWith('_')),
        );
        if (!registered && !NON_STORAGE_LITERALS.has(key)) missing.push(`${key} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('clearAllUserData', () => {
  it('appelle le nettoyage complet sans échec silencieux', async () => {
    const { clearAllUserData } = await freshModule();
    const { cancelAllNotifications } = await import('../notifications');

    disk['ocleaneo_chantiers_cache'] = 'data';
    await clearAllUserData();

    expect(disk['ocleaneo_chantiers_cache']).toBeUndefined();
    expect(cancelAllNotifications).toHaveBeenCalled();
  });
});
