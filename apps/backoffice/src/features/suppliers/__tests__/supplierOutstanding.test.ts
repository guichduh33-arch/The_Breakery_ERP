// apps/backoffice/src/features/suppliers/__tests__/supplierOutstanding.test.ts
//
// S3-07 — la règle de la fiche fournisseur doit être celle du rapport des
// paiements fournisseurs : bon reçu, non supprimé, hors import historique,
// encours = total − Σ paiements, retenu seulement s'il est > 0.

import { describe, expect, it } from 'vitest';
import {
  computeSupplierOutstanding,
  poOutstanding,
  sumPayments,
  type SupplierLedgerPo,
} from '../utils/supplierOutstanding.js';

function po(over: Partial<SupplierLedgerPo>): SupplierLedgerPo {
  return {
    status:               'received',
    total_amount:         1_000_000,
    is_historical_import: false,
    deleted_at:           null,
    paid_amount:          0,
    ...over,
  };
}

describe('poOutstanding', () => {
  it('counts a received credit PO that was never paid in full', () => {
    expect(poOutstanding(po({}))).toBe(1_000_000);
  });

  it('counts the remaining balance of a partly paid PO', () => {
    expect(poOutstanding(po({ paid_amount: 400_000 }))).toBe(600_000);
  });

  it('returns 0 for a fully paid PO', () => {
    expect(poOutstanding(po({ paid_amount: 1_000_000 }))).toBe(0);
  });

  it('returns 0 for a PO that is not received yet', () => {
    expect(poOutstanding(po({ status: 'pending' }))).toBe(0);
    expect(poOutstanding(po({ status: 'partial' }))).toBe(0);
    expect(poOutstanding(po({ status: 'cancelled' }))).toBe(0);
  });

  it('excludes historical imports', () => {
    expect(poOutstanding(po({ is_historical_import: true }))).toBe(0);
  });

  it('excludes deleted POs', () => {
    expect(poOutstanding(po({ deleted_at: '2026-11-01T00:00:00Z' }))).toBe(0);
  });

  it('returns 0 (never negative) for an overpaid PO', () => {
    expect(poOutstanding(po({ paid_amount: 1_200_000 }))).toBe(0);
  });

  it('accepts numeric strings from PostgREST', () => {
    expect(poOutstanding(po({ total_amount: '750000.50' }))).toBeCloseTo(750_000.5);
  });
});

describe('computeSupplierOutstanding', () => {
  it('sums positive balances only, counts open POs and total paid', () => {
    const summary = computeSupplierOutstanding([
      po({}),                                           // 1 000 000 dû
      po({ paid_amount: 250_000 }),                     //   750 000 dû
      po({ paid_amount: 1_500_000 }),                   // surpayé → 0
      po({ status: 'pending', paid_amount: 100_000 }),  // acompte, pas d'encours
      po({ is_historical_import: true }),               // hors encours
    ]);
    expect(summary.outstanding).toBe(1_750_000);
    expect(summary.openPoCount).toBe(2);
    expect(summary.totalPaid).toBe(250_000 + 1_500_000 + 100_000);
  });

  it('returns zeros for an empty list', () => {
    expect(computeSupplierOutstanding([])).toEqual({ outstanding: 0, openPoCount: 0, totalPaid: 0 });
  });
});

describe('sumPayments', () => {
  it('sums embedded payment amounts and treats null as none', () => {
    expect(sumPayments(null)).toBe(0);
    expect(sumPayments([{ amount: 100 }, { amount: '50.5' }, { amount: null }])).toBe(150.5);
  });
});
