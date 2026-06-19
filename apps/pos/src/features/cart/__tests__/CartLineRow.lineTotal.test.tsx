// apps/pos/src/features/cart/__tests__/CartLineRow.lineTotal.test.tsx
//
// Bug 2 (Session 36) — guards the line-total contract:
//   line_total = unit_price × quantity   (no double counting).
// The symptom was a Croissant (Rp 25,000) showing Rp 100,000 for "added
// twice". The root cause was a double `add()` dispatch (quantity doubled), not
// the formula — but this test pins the formula so a future regression on the
// per-line computation is caught immediately.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CartItem } from '@breakery/domain';
import { CartLineRow } from '../CartLineRow';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

// useComboConfig is only invoked on the combo branch; we never hit it here
// (finished product), but mock it so importing the module never touches I/O.
vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: () => ({ data: undefined }),
}));

function makeItem(quantity: number): CartItem {
  return {
    id: 'l1',
    product_id: 'p-croissant',
    name: 'Croissant',
    unit_price: 25000,
    quantity,
    modifiers: [],
  };
}

describe('CartLineRow — line total = unit_price × quantity (Bug 2 contract)', () => {
  it.each<[number, RegExp]>([
    [1, /Rp\s*25,000/],
    [2, /Rp\s*50,000/],
    [3, /Rp\s*75,000/],
  ])('qty %i renders unit_price × quantity, never doubled', (quantity, expected) => {
    render(
      <CartLineRow
        item={makeItem(quantity)}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe('CartLineRow — per-line discount control', () => {
  it('renders a discount button for an editable line and fires onApplyLineDiscount', () => {
    const onApplyLineDiscount = vi.fn();
    render(
      <CartLineRow
        item={makeItem(2)}
        locked={false}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
        onApplyLineDiscount={onApplyLineDiscount}
      />,
    );
    const btn = screen.getByRole('button', { name: /apply discount on croissant/i });
    fireEvent.click(btn);
    expect(onApplyLineDiscount).toHaveBeenCalledTimes(1);
  });

  it('does not render the discount button on a locked (sent) line', () => {
    render(
      <CartLineRow
        item={makeItem(2)}
        locked
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
        onApplyLineDiscount={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /discount on croissant/i })).toBeNull();
  });
});
