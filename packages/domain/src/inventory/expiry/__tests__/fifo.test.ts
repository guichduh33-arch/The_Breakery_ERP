// packages/domain/src/inventory/expiry/__tests__/fifo.test.ts
// Session 13 — F1 expiry tracking : pure FIFO unit tests.
//
// These tests pin down the algorithm INDEPENDENTLY of the DB. The pgTAP
// suite `inventory_f1_lots.test.sql` enforces the SAME contract on the
// `_resolve_fifo_lot` SQL helper. Divergence between the two = bug.

import { describe, expect, it } from 'vitest';
import {
  allLotsExpiredOrConsumed,
  filterExpiringLots,
  selectLotForConsumption,
  type StockLotForFifo,
} from '../fifo.js';

const P = 'prod-A';
const Q = 'prod-B';

const lot = (
  id: string,
  expires_at: string,
  quantity = 10,
  status: StockLotForFifo['status'] = 'active',
  product_id: string = P,
  received_at: string | null = null,
): StockLotForFifo => ({
  id,
  product_id,
  quantity,
  expires_at,
  status,
  received_at,
});

describe('selectLotForConsumption (FIFO)', () => {
  it('returns no_active_lots when input array is empty', () => {
    expect(selectLotForConsumption([], P, 1)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
  });

  it('returns no_active_lots when no lot matches productId', () => {
    const lots = [lot('l1', '2026-05-20T00:00:00Z', 10, 'active', Q)];
    expect(selectLotForConsumption(lots, P, 1)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
  });

  it('ignores expired lots', () => {
    const lots = [lot('l1', '2026-05-20T00:00:00Z', 10, 'expired')];
    expect(selectLotForConsumption(lots, P, 1)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
  });

  it('ignores consumed lots', () => {
    const lots = [lot('l1', '2026-05-20T00:00:00Z', 10, 'consumed')];
    expect(selectLotForConsumption(lots, P, 1)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
  });

  it('ignores lots with quantity = 0 (drained but still active flag)', () => {
    const lots = [lot('l1', '2026-05-20T00:00:00Z', 0, 'active')];
    expect(selectLotForConsumption(lots, P, 1)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
  });

  it('returns the single eligible lot when only one matches', () => {
    const lots = [lot('l1', '2026-05-20T00:00:00Z', 5)];
    const result = selectLotForConsumption(lots, P, 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lot.id).toBe('l1');
  });

  it('picks the earliest-expiring lot among multiple active', () => {
    const lots = [
      lot('newer', '2026-05-25T00:00:00Z', 10),
      lot('older', '2026-05-15T00:00:00Z', 10),
      lot('newest', '2026-06-01T00:00:00Z', 10),
    ];
    const result = selectLotForConsumption(lots, P, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lot.id).toBe('older');
  });

  it('tie-breaks equal expires_at by received_at ASC (older receipt wins)', () => {
    const lots = [
      lot('late', '2026-05-15T00:00:00Z', 10, 'active', P, '2026-05-10T00:00:00Z'),
      lot('early', '2026-05-15T00:00:00Z', 10, 'active', P, '2026-05-08T00:00:00Z'),
    ];
    const result = selectLotForConsumption(lots, P, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lot.id).toBe('early');
  });

  it('tie-breaks equal expires_at AND received_at by id ASC', () => {
    const lots = [
      lot('bbb', '2026-05-15T00:00:00Z', 10, 'active', P, '2026-05-10T00:00:00Z'),
      lot('aaa', '2026-05-15T00:00:00Z', 10, 'active', P, '2026-05-10T00:00:00Z'),
    ];
    const result = selectLotForConsumption(lots, P, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lot.id).toBe('aaa');
  });

  it('treats null received_at as later than explicit dates (explicit wins tie)', () => {
    const lots = [
      lot('null-rec', '2026-05-15T00:00:00Z', 10, 'active', P, null),
      lot('dated', '2026-05-15T00:00:00Z', 10, 'active', P, '2026-05-09T00:00:00Z'),
    ];
    const result = selectLotForConsumption(lots, P, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lot.id).toBe('dated');
  });

  it('returns insufficient_qty when FIFO head has less than needed (MVP: no auto-split)', () => {
    const lots = [
      lot('l1', '2026-05-15T00:00:00Z', 2),
      lot('l2', '2026-05-20T00:00:00Z', 100),
    ];
    const result = selectLotForConsumption(lots, P, 5);
    expect(result).toEqual({ ok: false, reason: 'insufficient_qty' });
  });

  it('returns no_active_lots when quantityNeeded is 0 or negative (defensive)', () => {
    const lots = [lot('l1', '2026-05-15T00:00:00Z', 10)];
    expect(selectLotForConsumption(lots, P, 0)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
    expect(selectLotForConsumption(lots, P, -3)).toEqual({
      ok: false,
      reason: 'no_active_lots',
    });
  });

  it('does not mutate input array (sort is on a copy)', () => {
    const lots: StockLotForFifo[] = [
      lot('newer', '2026-05-25T00:00:00Z', 10),
      lot('older', '2026-05-15T00:00:00Z', 10),
    ];
    const beforeIds = lots.map((l) => l.id);
    selectLotForConsumption(lots, P, 1);
    expect(lots.map((l) => l.id)).toEqual(beforeIds);
  });
});

describe('allLotsExpiredOrConsumed', () => {
  it('returns false when product has no lots (not under F1)', () => {
    expect(allLotsExpiredOrConsumed([], P)).toBe(false);
  });

  it('returns false when at least one active lot has qty > 0', () => {
    const lots = [
      lot('l1', '2026-05-15T00:00:00Z', 0, 'active'),
      lot('l2', '2026-05-20T00:00:00Z', 5, 'active'),
    ];
    expect(allLotsExpiredOrConsumed(lots, P)).toBe(false);
  });

  it('returns true when every lot is expired', () => {
    const lots = [
      lot('l1', '2026-05-15T00:00:00Z', 10, 'expired'),
      lot('l2', '2026-05-20T00:00:00Z', 5, 'expired'),
    ];
    expect(allLotsExpiredOrConsumed(lots, P)).toBe(true);
  });

  it('returns true when every active lot has qty <= 0', () => {
    const lots = [
      lot('l1', '2026-05-15T00:00:00Z', 0, 'active'),
      lot('l2', '2026-05-20T00:00:00Z', 0, 'active'),
    ];
    expect(allLotsExpiredOrConsumed(lots, P)).toBe(true);
  });

  it('returns true when all lots are consumed', () => {
    const lots = [lot('l1', '2026-05-15T00:00:00Z', 0, 'consumed')];
    expect(allLotsExpiredOrConsumed(lots, P)).toBe(true);
  });

  it('mixed: expired + consumed counts as dead', () => {
    const lots = [
      lot('l1', '2026-05-15T00:00:00Z', 5, 'expired'),
      lot('l2', '2026-05-20T00:00:00Z', 0, 'consumed'),
    ];
    expect(allLotsExpiredOrConsumed(lots, P)).toBe(true);
  });

  it('only considers lots for the requested product', () => {
    const lots = [
      lot('l1', '2026-05-15T00:00:00Z', 5, 'active', P), // healthy P lot
      lot('l2', '2026-05-20T00:00:00Z', 5, 'expired', Q), // dead Q lot
    ];
    expect(allLotsExpiredOrConsumed(lots, P)).toBe(false);
    expect(allLotsExpiredOrConsumed(lots, Q)).toBe(true);
  });
});

describe('filterExpiringLots', () => {
  const NOW = new Date('2026-05-13T12:00:00Z');

  it('returns empty array when no lots provided', () => {
    expect(filterExpiringLots([], 24, NOW)).toEqual([]);
  });

  it('includes lots expiring within the window', () => {
    const lots = [
      lot('soon', '2026-05-13T20:00:00Z', 10), // +8h
      lot('later', '2026-05-15T00:00:00Z', 10), // +36h (outside 24h)
    ];
    const result = filterExpiringLots(lots, 24, NOW);
    expect(result.map((l) => l.id)).toEqual(['soon']);
  });

  it('includes already-expired lots (until cron flips status)', () => {
    const lots = [
      lot('past', '2026-05-13T08:00:00Z', 10, 'active'), // 4h ago
    ];
    const result = filterExpiringLots(lots, 24, NOW);
    expect(result.map((l) => l.id)).toEqual(['past']);
  });

  it('excludes lots whose status is no longer active', () => {
    const lots = [
      lot('flipped', '2026-05-13T20:00:00Z', 10, 'expired'),
      lot('alive', '2026-05-13T22:00:00Z', 10, 'active'),
    ];
    const result = filterExpiringLots(lots, 24, NOW);
    expect(result.map((l) => l.id)).toEqual(['alive']);
  });

  it('sorts results by expires_at ASC', () => {
    const lots = [
      lot('mid', '2026-05-13T20:00:00Z', 10),
      lot('soonest', '2026-05-13T14:00:00Z', 10),
      lot('latest', '2026-05-13T23:00:00Z', 10),
    ];
    const result = filterExpiringLots(lots, 24, NOW);
    expect(result.map((l) => l.id)).toEqual(['soonest', 'mid', 'latest']);
  });

  it('honors the hoursAhead window strictly', () => {
    const lots = [
      lot('inside', '2026-05-13T23:59:00Z', 10), // +11h59m
      lot('outside', '2026-05-14T13:00:00Z', 10), // +25h
    ];
    expect(filterExpiringLots(lots, 12, NOW).map((l) => l.id)).toEqual(['inside']);
    expect(filterExpiringLots(lots, 24, NOW).map((l) => l.id)).toEqual(['inside']);
    expect(filterExpiringLots(lots, 30, NOW).map((l) => l.id)).toEqual(['inside', 'outside']);
  });
});
