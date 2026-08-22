import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const SHIFT_NOTIFICATION_ID = 1001;
const CHANNEL_ID = 'pointage';

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
  } catch {
    // Le canal existe peut-être déjà, ou la plateforme ne le supporte pas.
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
