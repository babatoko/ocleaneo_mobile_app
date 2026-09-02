import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * isNfcEnabled()/openNfcSettings() parlent à un plugin natif maison
 * (NfcStatus, android/app/.../NfcStatusPlugin.java) — aucun plugin tiers ne
 * sait dire si le NFC est activé dans les réglages Android, seulement s'il
 * est supporté par l'appareil (isNfcSupported, testé séparément ci-dessous).
 * Le point à verrouiller : sur toute plateforme autre qu'Android (iOS, web),
 * ces fonctions se replient proprement plutôt que d'appeler un plugin natif
 * qui n'existe pas là-bas.
 */

let platform = 'android';
const isEnabledImpl = vi.fn();
const openSettingsImpl = vi.fn();
const nfcIsSupportedImpl = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform,
    isNativePlatform: () => platform !== 'web',
  },
  registerPlugin: () => ({
    isEnabled: () => isEnabledImpl(),
    openSettings: () => openSettingsImpl(),
  }),
}));

vi.mock('@exxili/capacitor-nfc', () => ({
  NFC: { isSupported: () => nfcIsSupportedImpl() },
}));

beforeEach(() => {
  platform = 'android';
  isEnabledImpl.mockReset().mockResolvedValue({ supported: true, enabled: true });
  openSettingsImpl.mockReset().mockResolvedValue(undefined);
  nfcIsSupportedImpl.mockReset().mockResolvedValue({ supported: true });
});

describe('isNfcEnabled', () => {
  it('renvoie enabled tel que rapporté par le plugin natif sur Android', async () => {
    const { isNfcEnabled } = await import('../nfc');
    isEnabledImpl.mockResolvedValue({ supported: true, enabled: false });

    expect(await isNfcEnabled()).toBe(false);
  });

  it("renvoie null sur iOS/web, sans appeler le plugin natif (n'existe pas hors Android)", async () => {
    platform = 'ios';
    const { isNfcEnabled } = await import('../nfc');

    expect(await isNfcEnabled()).toBeNull();
    expect(isEnabledImpl).not.toHaveBeenCalled();
  });

  it('renvoie null si le plugin natif lève (pas encore synchronisé sur ce build, etc.)', async () => {
    isEnabledImpl.mockRejectedValue(new Error('not implemented'));
    const { isNfcEnabled } = await import('../nfc');

    expect(await isNfcEnabled()).toBeNull();
  });
});

describe('openNfcSettings', () => {
  it('appelle le plugin natif sur Android', async () => {
    const { openNfcSettings } = await import('../nfc');
    await openNfcSettings();

    expect(openSettingsImpl).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien hors Android", async () => {
    platform = 'web';
    const { openNfcSettings } = await import('../nfc');
    await openNfcSettings();

    expect(openSettingsImpl).not.toHaveBeenCalled();
  });
});

describe('isNfcSupported', () => {
  it('renvoie false hors plateforme native', async () => {
    platform = 'web';
    const { isNfcSupported } = await import('../nfc');

    expect(await isNfcSupported()).toBe(false);
  });

  it('renvoie le support rapporté par le plugin sur natif', async () => {
    nfcIsSupportedImpl.mockResolvedValue({ supported: true });
    const { isNfcSupported } = await import('../nfc');

    expect(await isNfcSupported()).toBe(true);
  });

  it('renvoie false si le plugin lève', async () => {
    nfcIsSupportedImpl.mockRejectedValue(new Error('boom'));
    const { isNfcSupported } = await import('../nfc');

    expect(await isNfcSupported()).toBe(false);
  });
});
