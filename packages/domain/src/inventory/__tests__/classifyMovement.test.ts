// packages/domain/src/inventory/__tests__/classifyMovement.test.ts

import { describe, expect, it } from 'vitest';
import { classifyMovement } from '../classifyMovement.js';
import type { StockMovement, MovementType } from '../types.js';

const mvt = (movementType: MovementType, quantity: number): StockMovement => ({
  id: 'm-1',
  productId: 'p-1',
  movementType,
  quantity,
  referenceType: 'order',
  createdBy: 'u-1',
  createdAt: '2026-05-12T08:00:00Z',
});

describe('classifyMovement', () => {
  it('sale (negative qty) → OUT + isSale, NOT admin', () => {
    expect(classifyMovement(mvt('sale', -2))).toEqual({
      direction: 'OUT',
      isSale: true,
      isAdmin: false,
    });
  });

  it('sale_void (positive qty) → IN + isSale', () => {
    expect(classifyMovement(mvt('sale_void', 2))).toEqual({
      direction: 'IN',
      isSale: true,
      isAdmin: false,
    });
  });

  it('adjustment positive → IN + isAdmin', () => {
    expect(classifyMovement(mvt('adjustment', 5))).toEqual({
      direction: 'IN',
      isSale: false,
      isAdmin: true,
    });
  });

  it('adjustment negative → OUT + isAdmin', () => {
    expect(classifyMovement(mvt('adjustment', -3))).toEqual({
      direction: 'OUT',
      isSale: false,
      isAdmin: true,
    });
  });

  it('waste → OUT + isAdmin', () => {
    expect(classifyMovement(mvt('waste', -1))).toEqual({
      direction: 'OUT',
      isSale: false,
      isAdmin: true,
    });
  });

  it('purchase → IN + isAdmin', () => {
    expect(classifyMovement(mvt('purchase', 50))).toEqual({
      direction: 'IN',
      isSale: false,
      isAdmin: true,
    });
  });

  it('production → IN + isAdmin', () => {
    expect(classifyMovement(mvt('production', 20))).toEqual({
      direction: 'IN',
      isSale: false,
      isAdmin: true,
    });
  });
});
