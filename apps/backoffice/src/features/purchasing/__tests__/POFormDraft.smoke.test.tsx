// apps/backoffice/src/features/purchasing/__tests__/POFormDraft.smoke.test.tsx
// Session 13 — Phase 3.A — POFormDraft minimal render + validation smoke.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  POFormDraft,
  emptyPOFormDraftValue,
  validatePOFormDraft,
  toCreatePOItems,
  type POFormDraftValue,
} from '../components/POFormDraft.js';

const SUPPLIERS = [
  { id: 'sup-1', code: 'AAA', name: 'Test Supplier A' },
];
const PRODUCTS = [
  { id: 'prod-1', sku: 'P-1', name: 'Test Product', unit: 'kg', cost_price: 3000 },
];

describe('POFormDraft smoke', () => {
  it('renders header fields, line table, and submit button', () => {
    const onChange = vi.fn();
    render(
      <POFormDraft
        value={emptyPOFormDraftValue()}
        onChange={onChange}
        suppliers={SUPPLIERS}
        products={PRODUCTS}
      />,
    );
    expect(screen.getByLabelText(/^Supplier$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Payment terms/i)).toBeInTheDocument();
    expect(screen.getByText(/Line items/i)).toBeInTheDocument();
    expect(screen.getByTestId('po-form-items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create purchase order/i })).toBeInTheDocument();
  });

  it('+ Add line increases item count', () => {
    let v: POFormDraftValue = emptyPOFormDraftValue();
    const onChange = vi.fn((next: POFormDraftValue) => { v = next; });
    const { rerender } = render(
      <POFormDraft value={v} onChange={onChange} suppliers={SUPPLIERS} products={PRODUCTS} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add line/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(v.items.length).toBe(2);
    rerender(<POFormDraft value={v} onChange={onChange} suppliers={SUPPLIERS} products={PRODUCTS} />);
    expect(screen.getAllByRole('combobox').filter((el) =>
      (el as HTMLSelectElement).options[0]?.text?.startsWith('— Select —')).length).toBe(2);
  });

  it('shows error prop in alert', () => {
    render(
      <POFormDraft
        value={emptyPOFormDraftValue()}
        onChange={vi.fn()}
        suppliers={SUPPLIERS}
        products={PRODUCTS}
        error="Supplier required"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Supplier required/);
  });
});

describe('validatePOFormDraft', () => {
  it('flags missing supplier', () => {
    const v = emptyPOFormDraftValue();
    expect(validatePOFormDraft(v)).toBe('Supplier required');
  });

  it('flags 0 quantity', () => {
    const v: POFormDraftValue = {
      ...emptyPOFormDraftValue(),
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantity: 0, unit: 'kg', unitCost: 100, notes: '' }],
    };
    expect(validatePOFormDraft(v)).toMatch(/quantity/);
  });

  it('accepts valid form', () => {
    const v: POFormDraftValue = {
      ...emptyPOFormDraftValue(),
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantity: 5, unit: 'kg', unitCost: 100, notes: '' }],
    };
    expect(validatePOFormDraft(v)).toBeUndefined();
  });

  it('toCreatePOItems strips empty unit/notes', () => {
    const v: POFormDraftValue = {
      ...emptyPOFormDraftValue(),
      supplierId: 'sup-1',
      items: [
        { productId: 'prod-1', quantity: 5, unit: '', unitCost: 100, notes: '' },
        { productId: 'prod-2', quantity: 2, unit: 'pcs', unitCost: 50, notes: 'urgent' },
      ],
    };
    const items = toCreatePOItems(v);
    expect(items[0]).toEqual({ productId: 'prod-1', quantity: 5, unit: undefined, unitCost: 100, notes: undefined });
    expect(items[1]).toEqual({ productId: 'prod-2', quantity: 2, unit: 'pcs', unitCost: 50, notes: 'urgent' });
  });
});
