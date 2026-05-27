import { describe, expect, it } from 'vitest';
import { buildDrilldownUrl, type DrilldownEntity } from '../buildDrilldownUrl.js';

describe('buildDrilldownUrl', () => {
  it('T1 product → /backoffice/products/:id', () => {
    expect(buildDrilldownUrl('product', 'p-1')).toBe('/backoffice/products/p-1');
  });

  it('T2 user → /backoffice/users/:id', () => {
    expect(buildDrilldownUrl('user', 'u-1')).toBe('/backoffice/users/u-1');
  });

  it('T3 supplier → /backoffice/suppliers/:id', () => {
    expect(buildDrilldownUrl('supplier', 's-1')).toBe('/backoffice/suppliers/s-1');
  });

  it('T4 expense → /backoffice/expenses/:id', () => {
    expect(buildDrilldownUrl('expense', 'e-1')).toBe('/backoffice/expenses/e-1');
  });

  it('T5 purchase_order → /backoffice/purchasing/purchase-orders/:id', () => {
    expect(buildDrilldownUrl('purchase_order', 'po-1')).toBe(
      '/backoffice/purchasing/purchase-orders/po-1',
    );
  });

  it('T6 customer → /backoffice/customers/:id', () => {
    expect(buildDrilldownUrl('customer', 'c-1')).toBe('/backoffice/customers/c-1');
  });

  it('T7 order → /backoffice/orders/:id', () => {
    expect(buildDrilldownUrl('order', 'o-1')).toBe('/backoffice/orders/o-1');
  });

  it('T8 recipe → /backoffice/inventory/recipes/:id', () => {
    expect(buildDrilldownUrl('recipe', 'r-1')).toBe('/backoffice/inventory/recipes/r-1');
  });

  it('T9 category → /backoffice/products?category_id=:id', () => {
    expect(buildDrilldownUrl('category', 'cat-1')).toBe(
      '/backoffice/products?category_id=cat-1',
    );
  });

  it('T10 account → /backoffice/accounting/general-ledger?account_id=:id', () => {
    expect(buildDrilldownUrl('account', 'acc-1')).toBe(
      '/backoffice/accounting/general-ledger?account_id=acc-1',
    );
  });

  it('T11 filter date_from/date_to is appended', () => {
    expect(
      buildDrilldownUrl('account', 'acc-1', {
        date_from: '2026-01-01',
        date_to: '2026-01-31',
      }),
    ).toBe(
      '/backoffice/accounting/general-ledger?account_id=acc-1&date_from=2026-01-01&date_to=2026-01-31',
    );
  });

  it('T12 empty id returns null', () => {
    expect(buildDrilldownUrl('order', '')).toBeNull();
  });

  it('T13 unknown entity returns null', () => {
    expect(buildDrilldownUrl('terminal' as DrilldownEntity, 't-1')).toBeNull();
  });

  it('T14 order_list with payment_method + date range → /backoffice/orders?...', () => {
    expect(
      buildDrilldownUrl('order_list', '', {
        payment_method: 'cash',
        start: '2026-05-01',
        end: '2026-05-31',
      }),
    ).toBe('/backoffice/orders?payment_method=cash&start=2026-05-01&end=2026-05-31');
  });

  it('T15 order_list with hour + start + end', () => {
    expect(
      buildDrilldownUrl('order_list', '', {
        hour: 14,
        start: '2026-05-15',
        end: '2026-05-15',
      }),
    ).toBe('/backoffice/orders?hour=14&start=2026-05-15&end=2026-05-15');
  });

  it('T16 order_list with empty filter → /backoffice/orders', () => {
    expect(buildDrilldownUrl('order_list', '')).toBe('/backoffice/orders');
  });

  it('T17 order_list with customer_id', () => {
    expect(buildDrilldownUrl('order_list', '', { customer_id: 'c-1' })).toBe(
      '/backoffice/orders?customer_id=c-1',
    );
  });

  it('T18 order_list with served_by + terminal-equivalent filter', () => {
    expect(
      buildDrilldownUrl('order_list', '', { served_by: 'u-1', status: 'completed' }),
    ).toBe('/backoffice/orders?served_by=u-1&status=completed');
  });
});
