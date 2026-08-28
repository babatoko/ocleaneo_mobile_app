import { ref } from 'vue';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const providerKind = ref<'rest' | 'odoo' | 'mock'>('rest');
const setProviderKindMock = vi.fn(async (kind: string) => {
  providerKind.value = kind as 'rest' | 'odoo' | 'mock';
});

vi.mock('../../providers', () => ({
  providerKind,
  DEFAULT_PROVIDER_KIND: 'rest',
  setProviderKind: setProviderKindMock,
}));

const { useProviderKind, PROVIDER_KINDS, PROVIDER_KIND_LABELS } = await import('../useProviderKind');

describe('useProviderKind', () => {
  beforeEach(() => {
    providerKind.value = 'rest';
    setProviderKindMock.mockClear();
  });

  it('expose le backend actif et le défaut de build', () => {
    const p = useProviderKind();
    expect(p.providerKind.value).toBe('rest');
    expect(p.defaultProviderKind).toBe('rest');
  });

  it('selectProviderKind appelle setProviderKind et rapporte le changement', async () => {
    const p = useProviderKind();
    const changed = await p.selectProviderKind('odoo');
    expect(changed).toBe(true);
    expect(setProviderKindMock).toHaveBeenCalledWith('odoo');
    expect(p.providerKind.value).toBe('odoo');
  });

  it('selectProviderKind est un no-op silencieux si le backend est déjà actif', async () => {
    const p = useProviderKind();
    const changed = await p.selectProviderKind('rest');
    expect(changed).toBe(false);
    expect(setProviderKindMock).not.toHaveBeenCalled();
  });

  it('couvre les trois backends avec un libellé', () => {
    expect(PROVIDER_KINDS).toEqual(['odoo', 'rest', 'mock']);
    for (const kind of PROVIDER_KINDS) {
      expect(PROVIDER_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});
