import { describe, expect, it, vi } from 'vitest';
import { emitSessionExpired, onSessionExpired } from '../sessionEvents';

// Le registre d'écouteurs est un singleton de module (comme tokenStore.ts) :
// pas de reset entre les tests de ce fichier, donc chaque test ajoute les
// siens plutôt que de supposer un registre vide.

describe('sessionEvents', () => {
  it('appelle chaque écouteur inscrit quand la session expire', () => {
    const a = vi.fn();
    const b = vi.fn();
    onSessionExpired(a);
    onSessionExpired(b);

    emitSessionExpired();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('rappelle un écouteur à chaque nouvelle expiration', () => {
    const listener = vi.fn();
    onSessionExpired(listener);

    emitSessionExpired();
    emitSessionExpired();

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
