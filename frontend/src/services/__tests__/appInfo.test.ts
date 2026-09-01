import { describe, expect, it, vi } from 'vitest';

/**
 * getAppVersion() est ce qui permet à un salarié ou à qui le dépanne de
 * confirmer "j'ai bien la dernière version" sans ouvrir Android Studio —
 * utile en particulier pour vérifier qu'un correctif signalé est bien
 * arrivé sur le téléphone en question. Le point à verrouiller : le repli
 * web (App.getInfo() n'est pas implémenté hors natif, voir
 * node_modules/@capacitor/app — AppWeb.getInfo() lève) ne doit jamais
 * faire planter l'écran qui l'affiche.
 *
 * Chaque test réimporte le module à neuf (vi.resetModules) : getAppVersion
 * met son résultat en cache au niveau module, ce qui masquerait le
 * comportement du second scénario si les deux partageaient l'import.
 */

let getInfoImpl: () => Promise<{ version: string }>;

vi.mock('@capacitor/app', () => ({
  App: { getInfo: () => getInfoImpl() },
}));

describe('getAppVersion', () => {
  it('renvoie le versionName natif quand le plugin répond', async () => {
    vi.resetModules();
    getInfoImpl = async () => ({ version: '2026.09.01-0942' });
    const { getAppVersion } = await import('../appInfo');

    expect(await getAppVersion()).toBe('2026.09.01-0942');
  });

  it('retombe sur la date de build (web) sans lever si le plugin natif est indisponible', async () => {
    vi.resetModules();
    getInfoImpl = async () => {
      throw new Error('Not implemented on web.');
    };
    const { getAppVersion } = await import('../appInfo');

    await expect(getAppVersion()).resolves.not.toBe('');
  });
});
