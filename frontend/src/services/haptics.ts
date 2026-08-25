import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export function hapticSuccess(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export function hapticError(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.notification({ type: NotificationType.Error }).catch(() => {});
}

export function hapticTap(): void {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}
