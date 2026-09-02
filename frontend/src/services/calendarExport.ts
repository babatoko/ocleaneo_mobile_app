import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { Shift } from '../types/models';

interface CalendarSharePlugin {
  shareIcs(options: { path: string; title: string }): Promise<void>;
}
// Natif Android uniquement (android/.../CalendarSharePlugin.java) — voir
// pourquoi juste en dessous.
const CalendarShare = registerPlugin<CalendarSharePlugin>('CalendarShare');

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

  // Sur Android, @capacitor/share laisse l'OS deviner le type MIME du
  // fichier à partir de son extension (MimeTypeMap) — qui ne connaît pas
  // ".ics" et retombe sur "*/*". Sous ce type générique, aucune application
  // Calendrier ne s'annonce dans la feuille de partage : l'agent n'a alors
  // aucun moyen d'ajouter le planning à son agenda en un geste. Un petit
  // plugin natif (CalendarSharePlugin.java) pose "text/calendar"
  // explicitement, sans deviner. Sur iOS, l'UTI de ".ics" est déjà reconnue
  // nativement (Calendrier apparaît normalement) — pas besoin de ce
  // contournement.
  if (Capacitor.getPlatform() === 'android') {
    await CalendarShare.shareIcs({ path: uri, title: 'Planning Ocleaneo' });
    return;
  }

  try {
    await Share.share({ title: 'Planning Ocleaneo', url: uri });
  } catch (e) {
    // @capacitor/share rejette avec exactement ce message (iOS ici — le cas
    // Android passe par CalendarShare ci-dessus) quand le salarié ferme la
    // feuille de partage sans choisir d'application. Le .ics est déjà écrit
    // à ce stade : ce n'est pas un échec de l'export, juste un choix de ne
    // pas le partager tout de suite — pas la peine de le signaler comme une
    // erreur (message technique en anglais, en plus).
    if (e instanceof Error && e.message === 'Share canceled') return;
    throw e;
  }
}
