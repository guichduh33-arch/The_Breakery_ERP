// S3-06 — frais de livraison et escomptes : formulaire de bon et dialogue de réception.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  POFormDraft,
  emptyPOFormDraftValue,
  validatePOFormDraft,
  toCreatePOItems,
  type POFormDraftValue,
} from '../components/POFormDraft.js';
import { ReceiveDialog } from '../components/ReceiveDialog.js';
import type { PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';

const SUPPLIERS = [{ id: 'sup-1', code: 'AAA', name: 'Test Supplier A' }];
const PRODUCTS = [{ id: 'prod-1', sku: 'P-1', name: 'Test Product', unit: 'kg', cost_price: 0 }];

function line(quantity: number, unitCost: number, discountAmount = 0): POFormDraftValue['items'][number] {
  return { productId: 'prod-1', quantity, unit: 'kg', unitFactorToBase: 1, unitCost, discountAmount, notes: '' };
}

describe('PO form — delivery fee and discounts', () => {
  it('shows the discount and the fee in the summary and in the total', () => {
    const value: POFormDraftValue = {
      ...emptyPOFormDraftValue(), supplierId: 'sup-1', vatRate: 0.11,
      discountAmount: 1_000, deliveryFee: 7_000,
      items: [line(3, 10_000, 1_000), line(7, 3_333.33)],
    };
    render(<POFormDraft layout="document" value={value} onChange={vi.fn()} suppliers={SUPPLIERS} products={PRODUCTS} />);
    const summary = within(screen.getByRole('complementary', { name: 'Purchase order summary' }));
    expect(summary.getByText('Order discount')).toBeInTheDocument();
    expect(summary.getByText('Delivery fee')).toBeInTheDocument();
    expect(summary.getByText(/63\.98\d/)).toBeInTheDocument();       // 63 979,97, IDR shown whole
    expect(screen.getByText(/spread across the lines/i)).toBeInTheDocument();
  });

  it('refuses a line discount above the line value and an order discount above the subtotal', () => {
    const base = { ...emptyPOFormDraftValue(), supplierId: 'sup-1' };
    expect(validatePOFormDraft({ ...base, items: [line(1, 100, 101)] }))
      .toMatch(/Line 1: discount must be between 0 and the line value/);
    expect(validatePOFormDraft({ ...base, items: [line(1, 100, 10)], discountAmount: 91 }))
      .toMatch(/Order discount must be between 0 and the subtotal/);
    expect(validatePOFormDraft({ ...base, items: [line(1, 100)], deliveryFee: -1 }))
      .toMatch(/Delivery fee must be >= 0/);
    expect(validatePOFormDraft({ ...base, items: [line(1, 100, 10)], discountAmount: 90, deliveryFee: 5 }))
      .toBeUndefined();
  });

  it('sends the line discount only when it is set', () => {
    const items = toCreatePOItems({ ...emptyPOFormDraftValue(), items: [line(1, 100, 10), line(1, 100)] });
    expect(items[0]?.discountAmount).toBe(10);
    expect(items[1]).not.toHaveProperty('discountAmount');
  });
});

function poWithFee(): PurchaseOrderDetail {
  const item = (id: string, created: string, quantity: number, unitCost: number) => ({
    id, po_id: 'po-1', product_id: `p-${id}`, quantity, received_quantity: 0, unit: 'pcs',
    unit_cost: unitCost, unit_factor_to_base: 1, discount_amount: 0, notes: null,
    subtotal: quantity * unitCost, created_at: created, updated_at: created,
    products: { sku: `SKU-${id}`, name: `Item ${id}`, unit: 'pcs' },
  });
  return {
    id: 'po-1', po_number: 'PO-1', supplier_id: 'sup-1', status: 'pending', payment_terms: 'credit',
    subtotal: 300_001, discount_amount: 0, vat_amount: 0, delivery_fee: 30_000, total_amount: 330_001,
    purchase_order_items: [
      item('a', '2026-11-20T00:00:00Z', 10, 10_000),
      item('b', '2026-11-20T00:00:01Z', 5, 20_000),
      item('c', '2026-11-20T00:00:02Z', 4, 25_000.25),
    ],
    goods_receipt_notes: [],
  } as unknown as PurchaseOrderDetail;
}

describe('Receive dialog — delivery fee', () => {
  it('shows the fee-inclusive cost per unit and the receipt value with its fee share', () => {
    render(<ReceiveDialog po={poWithFee()} onCancel={vi.fn()} onConfirm={vi.fn(() => Promise.resolve())} />);
    expect(screen.getByText(/11\.000/)).toBeInTheDocument();          // (100 000 + 9 999,97) / 10
    const value = screen.getByTestId('receive-value');
    expect(value).toHaveTextContent(/330\.001/);                      // full receipt = PO total
    expect(value).toHaveTextContent(/30\.000/);                       // whole fee
  });
});
