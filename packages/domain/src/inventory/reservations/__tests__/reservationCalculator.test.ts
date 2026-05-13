// packages/domain/src/inventory/reservations/__tests__/reservationCalculator.test.ts
import { describe, it, expect } from 'vitest';
import {
  activeHeldQuantity,
  availableQuantity,
  canHoldQuantity,
  type ActiveReservation,
} from '../reservationCalculator.js';

const FIXED_NOW = new Date('2026-05-14T10:00:00Z');
const FUTURE = '2026-05-14T10:10:00Z';
const PAST = '2026-05-14T09:50:00Z';

describe('activeHeldQuantity', () => {
  it('returns 0 for empty input', () => {
    expect(activeHeldQuantity([], FIXED_NOW)).toBe(0);
  });

  it('sums only held + future rows', () => {
    const rows: ActiveReservation[] = [
      { quantity: 5, expiresAt: FUTURE, status: 'held' },
      { quantity: 3, expiresAt: FUTURE, status: 'held' },
      { quantity: 7, expiresAt: PAST,   status: 'held' },     // expired
      { quantity: 2, expiresAt: FUTURE, status: 'released' }, // not held
      { quantity: 4, expiresAt: FUTURE, status: 'consumed' }, // not held
    ];
    expect(activeHeldQuantity(rows, FIXED_NOW)).toBe(8);
  });

  it('ignores non-positive quantities defensively', () => {
    const rows: ActiveReservation[] = [
      { quantity: -1, expiresAt: FUTURE, status: 'held' },
      { quantity: 0,  expiresAt: FUTURE, status: 'held' },
      { quantity: 6,  expiresAt: FUTURE, status: 'held' },
    ];
    expect(activeHeldQuantity(rows, FIXED_NOW)).toBe(6);
  });

  it('ignores malformed expiresAt', () => {
    const rows: ActiveReservation[] = [
      { quantity: 9, expiresAt: 'not-a-date', status: 'held' },
      { quantity: 2, expiresAt: FUTURE,       status: 'held' },
    ];
    expect(activeHeldQuantity(rows, FIXED_NOW)).toBe(2);
  });
});

describe('availableQuantity', () => {
  it('returns full stock when no reservations', () => {
    expect(availableQuantity(100, [], FIXED_NOW)).toBe(100);
  });

  it('subtracts only active holds', () => {
    const rows: ActiveReservation[] = [
      { quantity: 30, expiresAt: FUTURE, status: 'held' },
      { quantity: 20, expiresAt: PAST,   status: 'held' },   // expired -> ignored
    ];
    expect(availableQuantity(100, rows, FIXED_NOW)).toBe(70);
  });

  it('clamps to zero (never negative)', () => {
    const rows: ActiveReservation[] = [
      { quantity: 150, expiresAt: FUTURE, status: 'held' },
    ];
    expect(availableQuantity(100, rows, FIXED_NOW)).toBe(0);
  });
});

describe('canHoldQuantity', () => {
  it('false when requested <= 0', () => {
    expect(canHoldQuantity(0, 100, [], FIXED_NOW)).toBe(false);
    expect(canHoldQuantity(-5, 100, [], FIXED_NOW)).toBe(false);
  });

  it('true when stock covers requested + existing holds', () => {
    const rows: ActiveReservation[] = [
      { quantity: 30, expiresAt: FUTURE, status: 'held' },
    ];
    expect(canHoldQuantity(70, 100, rows, FIXED_NOW)).toBe(true);
    expect(canHoldQuantity(71, 100, rows, FIXED_NOW)).toBe(false);
  });
});
