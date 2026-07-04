// apps/backoffice/src/features/accounting/__tests__/resolveJeSourceEntity.test.ts
//
// Session 59 / Task 6a — JE drilldown to source. Proves the reference_type →
// DrilldownEntity mapping produces the right final URL via buildDrilldownUrl
// (reused infra, not recoded), and that unmapped reference_types fall back
// to `null` (drawer/GL page render plain text, unchanged pre-Task-6a).

import { describe, it, expect } from 'vitest';
import { resolveJeSourceEntity } from '../utils/resolveJeSourceEntity.js';
import { buildDrilldownUrl } from '@/features/reports/utils/buildDrilldownUrl.js';

describe('resolveJeSourceEntity (S59 Task 6a)', () => {
  it('sale / sale_void / sale_refund / void / refund → order detail URL', () => {
    for (const rt of ['sale', 'sale_void', 'sale_refund', 'void', 'refund']) {
      const target = resolveJeSourceEntity(rt, 'o-1');
      expect(target).toEqual({ entity: 'order', id: 'o-1' });
      expect(buildDrilldownUrl(target!.entity, target!.id)).toBe('/backoffice/orders/o-1');
    }
  });

  it('expense / expense_payment → expense detail URL', () => {
    for (const rt of ['expense', 'expense_payment']) {
      const target = resolveJeSourceEntity(rt, 'e-1');
      expect(target).toEqual({ entity: 'expense', id: 'e-1' });
      expect(buildDrilldownUrl(target!.entity, target!.id)).toBe('/backoffice/expenses/e-1');
    }
  });

  it('b2b_order / b2b_payment / b2b_adjustment / b2b_order_cancel → Invoices tab URL (id ignored)', () => {
    for (const rt of ['b2b_order', 'b2b_payment', 'b2b_adjustment', 'b2b_order_cancel']) {
      const target = resolveJeSourceEntity(rt, 'whatever-id');
      expect(target).toEqual({ entity: 'b2b_invoices', id: '' });
      expect(buildDrilldownUrl(target!.entity, target!.id)).toBe('/backoffice/b2b/payments?tab=invoices');
    }
  });

  it('cash_movement → Treasury URL', () => {
    const target = resolveJeSourceEntity('cash_movement', 'cm-1');
    expect(target).toEqual({ entity: 'cash_treasury', id: '' });
    expect(buildDrilldownUrl(target!.entity, target!.id)).toBe('/backoffice/accounting/cash');
  });

  it('unmapped reference_types fall back to null', () => {
    const unmapped = [
      'manual', 'purchase', 'purchase_return', 'purchase_payment', 'shift_close',
      'adjustment', 'waste', 'opname', 'production', 'transfer', 'stock_movement',
      'year_close', 'pos_outstanding', 'pos_outstanding_payment',
    ];
    for (const rt of unmapped) {
      expect(resolveJeSourceEntity(rt, 'x')).toBeNull();
    }
  });

  it('null reference_type → null', () => {
    expect(resolveJeSourceEntity(null, null)).toBeNull();
  });

  it('missing reference_id on an id-based entity yields an empty id, buildDrilldownUrl returns null', () => {
    const target = resolveJeSourceEntity('sale', null);
    expect(target).toEqual({ entity: 'order', id: '' });
    expect(buildDrilldownUrl(target!.entity, target!.id)).toBeNull();
  });
});
