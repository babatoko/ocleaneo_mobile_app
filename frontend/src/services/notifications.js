import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const SHIFT_NOTIFICATION_ID = 1001;
const REMINDER_NOTIFICATION_ID = 1002;
const REMINDER_DELAY_MIN = 20;
const CHANNEL_ID = 'pointage';

const PLANNING_CHANNEL_ID = 'planning';
const SHIFT_REMINDER_BASE_ID = 3000; // + shift.id, plage dédiée pour ne pas collisionner avec le pointage
const SHIFT_REMINDER_BEFORE_MIN = 30;
let planChangeSeq = 0;

let permissionGranted = false;

function fmtTime(date) {
  return new Date(date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export async function ensureNotificationChannel() {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Pointage',
      description: 'Statut du chantier en cours',
      importance: 3, // DEFAULT
    });
    await LocalNotifications.createChannel({
      id: PLANNING_CHANNEL_ID,
      name: 'Planning',
      description: 'Rappels de vacation et changements de planning',
      importance: 3,
    });
  } catch {
    // Le(s) canal(aux) existe(nt) peut-être déjà, ou la plateforme ne le supporte pas.
  }
}

async function ensurePermission() {
  if (!Capacitor.isNativePlatform()) return false;
  if (permissionGranted) return true;
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'granted') {
    permissionGranted = true;
    return true;
  }
  const res = await LocalNotifications.requestPermissions();
  permissionGranted = res.display === 'granted';
  return permissionGranted;
}

/**
 * Affiche (ou met à jour) une notification permanente tant que le salarié est
 * pointé présent sur un chantier : heure d'arrivée réelle, fin estimée
 * (ajustée du retard/de l'avance pris à l'arrivée) et prochaine vacation du
 * jour si elle existe.
 */
export async function showClockedInNotification({ chantierName, arrivalAt, estimatedDeparture, next }) {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await ensurePermission())) return;

  const mainLine = `Arrivée ${fmtTime(arrivalAt)} · Fin prévue ${fmtTime(estimatedDeparture)}`;
  const lines = [mainLine];
  if (next) {
    lines.push(`Prochain : ${next.chantierName} · ${fmtTime(next.startAt)}`);
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id: SHIFT_NOTIFICATION_ID,
        title: `${chantierName} — en cours`,
        body: mainLine,
        largeBody: lines.join('\n'),
        summaryText: 'Pointage',
        channelId: CHANNEL_ID,
        ongoing: true,
        autoCancel: false,
      },
    ],
  });
}

export async function clearClockedInNotification() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id: SHIFT_NOTIFICATION_ID }] }).catch(() => {});
}

/**
 * Programme un rappel « vous êtes toujours pointé présent » à envoyer si le
 * salarié n'a pas badgé son départ {REMINDER_DELAY_MIN} minutes après la fin
 * estimée de sa vacation. Annulé au pointage de départ (voir ci-dessous) ou
 * remplacé par le prochain appel si un nouveau pointage d'arrivée est fait.
 */
export async function scheduleDepartureReminder({ chantierName, estimatedDeparture }) {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await ensurePermission())) return;

  const at = new Date(new Date(estimatedDeparture).getTime() + REMINDER_DELAY_MIN * 60000);
  if (at.getTime() <= Date.now()) return; // fin déjà dépassée de plus de 20 min : inutile

  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_NOTIFICATION_ID,
        title: 'Toujours sur le chantier ?',
        body: `Vous êtes encore pointé présent sur ${chantierName} — pensez à badger votre départ.`,
        channelId: CHANNEL_ID,
        schedule: { at },
      },
    ],
  });
}

export async function cancelDepartureReminder() {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id: REMINDER_NOTIFICATION_ID }] }).catch(() => {});
}

/**
 * Programme un rappel {SHIFT_REMINDER_BEFORE_MIN} min avant le début d'une
 * vacation. Un id dérivé de shift.id permet de ré-appeler cette fonction sans
 * créer de doublon : la notification existante est simplement remplacée.
 */
export async function scheduleShiftReminder(shift) {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await ensurePermission())) return;

  const at = new Date(new Date(shift.start_at).getTime() - SHIFT_REMINDER_BEFORE_MIN * 60000);
  if (at.getTime() <= Date.now()) return;

  await LocalNotifications.schedule({
    notifications: [
      {
        id: SHIFT_REMINDER_BASE_ID + Number(shift.id),
        title: 'Prochaine vacation bientôt',
        body: `${shift.chantier_name} à ${fmtTime(shift.start_at)}${shift.chantier_address ? ' — ' + shift.chantier_address : ''}`,
        channelId: PLANNING_CHANNEL_ID,
        schedule: { at },
      },
    ],
  });
}

export async function cancelShiftReminder(shiftId) {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id: SHIFT_REMINDER_BASE_ID + Number(shiftId) }] }).catch(() => {});
}

/** Notification ponctuelle « ton planning a changé », un id différent à chaque appel. */
export async function notifyPlanningChanged(message) {
  if (!Capacitor.isNativePlatform()) return;
  if (!(await ensurePermission())) return;

  planChangeSeq = (planChangeSeq + 1) % 1000;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: 5000 + planChangeSeq,
        title: 'Planning mis à jour',
        body: message,
        channelId: PLANNING_CHANNEL_ID,
      },
    ],
  });
}
