import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export function hapticSuccess() {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export function hapticError() {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.notification({ type: NotificationType.Error }).catch(() => {});
}

export function hapticTap() {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}
