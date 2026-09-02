import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Shift } from '../../types/models';

/**
 * @capacitor/share rejette avec exactement "Share canceled" (Android) quand
 * l'agent ferme la feuille de partage sans choisir d'application — le .ics
 * est déjà écrit à ce stade. Avant ce correctif, ce message technique en
 * anglais remontait tel quel jusqu'à l'écran (PlanningView.vue), comme si
 * l'export avait échoué. Ces tests verrouillent qu'il est désormais avalé,
 * et qu'un vrai échec de partage (tout autre message) continue de remonter.
 */

let native = true;
const writeFile = vi.fn(async (_opts: { path: string; data: string; directory: string; encoding: string }) => {});
const getUri = vi.fn(async (_opts: { path: string; directory: string }) => ({ uri: 'file:///cache/ocleaneo-planning.ics' }));
const share = vi.fn(async (_opts: { title: string; url: string }) => {});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: (opts: { path: string; data: string; directory: string; encoding: string }) => writeFile(opts),
    getUri: (opts: { path: string; directory: string }) => getUri(opts),
  },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: (opts: { title: string; url: string }) => share(opts) },
}));

const { exportShiftsToCalendar } = await import('../calendarExport');

function shift(id: number): Shift {
  return {
    id,
    employee_id: 1,
    chantier_id: id,
    chantier_name: 'Cegetel Macon',
    chantier_address: '12 rue des Frères Lumière',
    start_at: '2026-09-04T08:00:00.000Z',
    end_at: '2026-09-04T11:00:00.000Z',
    status: 'confirmed',
  };
}

beforeEach(() => {
  native = true;
  writeFile.mockClear();
  getUri.mockClear();
  share.mockReset().mockResolvedValue(undefined);
});

describe('exportShiftsToCalendar', () => {
  it('écrit le .ics puis ouvre la feuille de partage', async () => {
    await exportShiftsToCalendar([shift(1)], 'planning-semaine.ics');

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ title: 'Planning Ocleaneo', url: 'file:///cache/ocleaneo-planning.ics' });
  });

  it("n'échoue pas quand l'agent ferme la feuille de partage sans partager", async () => {
    share.mockRejectedValueOnce(new Error('Share canceled'));

    await expect(exportShiftsToCalendar([shift(1)])).resolves.toBeUndefined();
  });

  it('laisse remonter un vrai échec de partage', async () => {
    share.mockRejectedValueOnce(new Error('no activity found to handle intent'));

    await expect(exportShiftsToCalendar([shift(1)])).rejects.toThrow('no activity found to handle intent');
  });

  it("refuse hors de l'app installée (web/PWA)", async () => {
    native = false;

    await expect(exportShiftsToCalendar([shift(1)])).rejects.toThrow(
      "L'export calendrier n'est disponible que dans l'app installée sur le téléphone.",
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('ne fait rien pour une liste vide (pas de partage sans contenu)', async () => {
    await exportShiftsToCalendar([]);

    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });
});
