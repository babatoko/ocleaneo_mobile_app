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

    // Paramètres globaux à conserver
    disk['ocleaneo_server_url'] = 'https://prod.odoo.example';
    disk['ocleaneo_data_provider'] = 'odoo';
    disk['ocleaneo_trace_mode'] = 'true';
    disk['ocleaneo_error_log'] = JSON.stringify([{ message: 'bug' }]);

    await clearUserPreferences();

    expect(disk['ocleaneo_shifts_2026-08-05_2026-08-05']).toBeUndefined();
    expect(disk['ocleaneo_shifts_upcoming']).toBeUndefined();
    expect(disk['ocleaneo_chantiers_cache']).toBeUndefined();
    expect(disk['ocleaneo_pointage_offline_queue']).toBeUndefined();
    expect(disk['ocleaneo_pointage_pending_compte_rendu']).toBeUndefined();
    expect(disk['ocleaneo_pointage_failed_entries']).toBeUndefined();
    expect(disk['ocleaneo_tour_seen_42']).toBeUndefined();

    expect(disk['ocleaneo_server_url']).toBe('https://prod.odoo.example');
    expect(disk['ocleaneo_data_provider']).toBe('odoo');
    expect(disk['ocleaneo_trace_mode']).toBe('true');
    expect(disk['ocleaneo_error_log']).toBeTruthy();
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
