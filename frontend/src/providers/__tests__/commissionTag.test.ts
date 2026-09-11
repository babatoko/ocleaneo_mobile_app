import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Contrat provider du commissionnement : l'UID part brut (la normalisation
 * est serveur), le résultat porte le numéro à marquer et le marqueur
 * existing (idempotence), 403 = feature retirée.
 */

const provider = {
  commissionTag: vi.fn(),
};

vi.mock('../../providers', () => ({ provider }));

const okResult = {
  id: 42,
  name: 'NFC00042',
  uid: '045A3B82F16C80',
  state: 'draft',
  existing: false,
  company_id: 1,
};

beforeEach(() => {
  provider.commissionTag.mockReset();
});

describe('contrat commissionTag', () => {
  it('renvoie le numéro du tag et existing=false à la création', async () => {
    provider.commissionTag.mockResolvedValue(okResult);
    const r = await provider.commissionTag('045A3B82F16C80');
    expect(r.name).toBe('NFC00042');
    expect(r.existing).toBe(false);
  });

  it('existing=true au re-scan du même badge (aucune écriture côté serveur)', async () => {
    provider.commissionTag.mockResolvedValue({ ...okResult, existing: true });
    const r = await provider.commissionTag('045A3B82F16C80');
    expect(r.existing).toBe(true);
  });

  it('propage le 403 (flag inactif/hors ciblage) en ProviderError', async () => {
    const { ProviderError } = await import('../../providers/DataProvider');
    provider.commissionTag.mockRejectedValue(new ProviderError('feature not available', 403));
    await expect(provider.commissionTag('04XX')).rejects.toMatchObject({ status: 403 });
  });
});