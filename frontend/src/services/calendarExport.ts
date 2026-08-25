import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Shift } from '../types/models';

function toIcsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcs(text: string | null | undefined): string {
  return String(text || '').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

function buildIcs(shifts: Shift[]): string {
  const events = shifts.map((s) =>
    [
      'BEGIN:VEVENT',
      `UID:shift-${s.id}@ocleaneo.app`,
      `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
      `DTSTART:${toIcsDate(s.start_at)}`,
      `DTEND:${toIcsDate(s.end_at)}`,
      `SUMMARY:${escapeIcs(s.chantier_name)}`,
      `LOCATION:${escapeIcs(s.chantier_address || '')}`,
      `DESCRIPTION:${escapeIcs(s.note || 'Vacation Ocleaneo')}`,
      'END:VEVENT',
    ].join('\r\n')
  );
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ocleaneo//Planning//FR', ...events, 'END:VCALENDAR'].join('\r\n');
}

/**
 * Génère un .ics pour une ou plusieurs vacations et ouvre la feuille de
 * partage native pour que le salarié l'ajoute à son agenda personnel
 * (Calendrier iOS, Google Agenda…). Volontairement pas d'écriture directe
 * dans le calendrier du téléphone — ça demanderait la permission « accès
 * complet au calendrier », intrusive pour ce que ça apporte ici. Le fichier
 * .ics standard, partagé via la feuille système, fait le même travail sans
 * cette permission.
 */
export async function exportShiftsToCalendar(shifts: Shift[], filename = 'ocleaneo-planning.ics'): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("L'export calendrier n'est disponible que dans l'app installée sur le téléphone.");
  }
  if (!shifts.length) return;

  const ics = buildIcs(shifts);
  await Filesystem.writeFile({
    path: filename,
    data: ics,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({ title: 'Planning Ocleaneo', url: uri });
}
