// packages/domain/src/inventory/__tests__/computeStockDelta.test.ts

import { describe, expect, it } from 'vitest';
import { computeStockDelta } from '../computeStockDelta.js';
import type { StockMovement, MovementType } from '../types.js';

const mvt = (movementType: MovementType, quantity: number, id = 'm'): StockMovement => ({
  id,
  productId: 'p-1',
  movementType,
  quantity,
  referenceType: 'order',
  createdBy: 'u-1',
  createdAt: '2026-05-12T08:00:00Z',
});

describe('computeStockDelta', () => {
  it('empty array → 0', () => {
    expect(computeStockDelta([])).toBe(0);
  });

  it('single movement → its signed quantity', () => {
    expect(computeStockDelta([mvt('purchase', 12)])).toBe(12);
  });

  it('mixed signs sum correctly', () => {
    const movements = [
      mvt('purchase', 50, 'm1'),
      mvt('sale', -3, 'm2'),
      mvt('sale', -2, 'm3'),
      mvt('waste', -1, 'm4'),
      mvt('sale_void', 1, 'm5'),
    ];
    expect(computeStockDelta(movements)).toBe(45);
  });

  it('all-out movements yield a negative total', () => {
    expect(computeStockDelta([mvt('sale', -2), mvt('waste', -3)])).toBe(-5);
  });
});
