import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Shift } from '../../types/models';

/**
 * Deux comportements verrouillés ici :
 *
 * 1. @capacitor/share rejette avec exactement "Share canceled" quand l'agent
 *    ferme la feuille de partage sans choisir d'application — le .ics est
 *    déjà écrit à ce stade. Avant correctif, ce message technique en
 *    anglais remontait tel quel jusqu'à l'écran (PlanningView.vue), comme si
 *    l'export avait échoué. Un vrai échec de partage (tout autre message)
 *    doit continuer de remonter.
 * 2. Sur Android, la feuille de partage de @capacitor/share ne proposait
 *    aucune application Calendrier : le type MIME est deviné depuis
 *    l'extension via MimeTypeMap, qui ne connaît pas ".ics" et retombe sur
 *    "*\/*", sous lequel les applications Calendrier ne s'annoncent pas. Un
 *    plugin natif dédié (CalendarSharePlugin.java) prend le relais sur cette
 *    plateforme avec "text/calendar" posé explicitement — iOS, où l'UTI de
 *    ".ics" est déjà reconnue nativement, continue de passer par
 *    @capacitor/share sans changement.
 */

let native = true;
let platform = 'ios';
const writeFile = vi.fn(async (_opts: { path: string; data: string; directory: string; encoding: string }) => {});
const getUri = vi.fn(async (_opts: { path: string; directory: string }) => ({ uri: 'file:///cache/ocleaneo-planning.ics' }));
const share = vi.fn(async (_opts: { title: string; url: string }) => {});
const shareIcs = vi.fn(async (_opts: { path: string; title: string }) => {});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native, getPlatform: () => platform },
  registerPlugin: () => ({ shareIcs: (opts: { path: string; title: string }) => shareIcs(opts) }),
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
  platform = 'ios';
  writeFile.mockClear();
  getUri.mockClear();
  share.mockReset().mockResolvedValue(undefined);
  shareIcs.mockReset().mockResolvedValue(undefined);
});

describe('exportShiftsToCalendar', () => {
  it('écrit le .ics puis ouvre la feuille de partage (iOS)', async () => {
    await exportShiftsToCalendar([shift(1)], 'planning-semaine.ics');

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ title: 'Planning Ocleaneo', url: 'file:///cache/ocleaneo-planning.ics' });
    expect(shareIcs).not.toHaveBeenCalled();
  });

  it('passe par le plugin natif CalendarShare sur Android, avec le type MIME calendrier posé explicitement', async () => {
    platform = 'android';

    await exportShiftsToCalendar([shift(1)], 'planning-semaine.ics');

    expect(shareIcs).toHaveBeenCalledWith({ path: 'file:///cache/ocleaneo-planning.ics', title: 'Planning Ocleaneo' });
    expect(share).not.toHaveBeenCalled();
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
