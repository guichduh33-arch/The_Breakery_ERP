// apps/pos/src/features/payment/__tests__/order-summary-panel.smoke.test.tsx
//
// Critique 2026-08-29 (P1 ×2) — the terminal's client-facing recap recomputed
// its own line total, ignoring combo component-modifier adjustments (ADR-017)
// and rendering cancelled lines at full price with no distinction. Both are
// pinned here: the recap consumes lineTotalOf (the same formula
// calculateTotals bills) and strikes cancelled lines with a badge.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Cart, CartItem } from '@breakery/domain';
import { OrderSummaryPanel } from '../components/OrderSummaryPanel';

function makeCart(items: CartItem[]): Cart {
  return { items, order_type: 'take_out' };
}

const totals = {
  subtotal: 0,
  tax_amount: 0,
  total: 0,
  item_count: 1,
  redemption_amount: 0,
};

describe('OrderSummaryPanel — line totals match what the cart bills', () => {
  it('bills a combo line with component-modifier adjustments (ADR-017)', () => {
    const combo: CartItem = {
      id: 'l1',
      product_id: 'p-combo',
      name: 'Breakfast Combo',
      product_type: 'combo',
      unit_price: 50000,
      quantity: 2,
      // Option surcharge on the line itself: +5,000.
      modifiers: [{ group_name: 'Size', option_label: 'Large', price_adjustment: 5000 }],
      // Component-modifier adjustment: +3,000 (the part the old recap dropped).
      combo_components: [
        {
          product_id: 'p-espresso',
          quantity: 1,
          modifiers: [{ group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 3000 }],
        },
      ],
    };

    render(
      <OrderSummaryPanel
        cart={makeCart([combo])}
        attachedCustomer={null}
        appliedPromotions={[]}
        totals={totals}
        taxInclusive
      />,
    );

    // (50,000 + 5,000 + 3,000) × 2 = 116,000 — NOT (50,000 + 5,000) × 2 = 110,000.
    expect(screen.getByText(/Rp\s*116\.000/)).toBeInTheDocument();
    expect(screen.queryByText(/Rp\s*110\.000/)).not.toBeInTheDocument();
  });

  it('strikes a cancelled line and badges it instead of billing it', () => {
    const cancelled: CartItem = {
      id: 'l2',
      product_id: 'p-bagel',
      name: 'American Bagel',
      unit_price: 70000,
      quantity: 1,
      modifiers: [],
      is_cancelled: true,
    };

    render(
      <OrderSummaryPanel
        cart={makeCart([cancelled])}
        attachedCustomer={null}
        appliedPromotions={[]}
        totals={totals}
        taxInclusive
      />,
    );

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    const name = screen.getByText(/American Bagel/);
    expect(name.className).toContain('line-through');
  });
});
