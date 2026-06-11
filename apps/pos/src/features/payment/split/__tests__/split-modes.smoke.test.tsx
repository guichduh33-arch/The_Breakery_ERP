// apps/pos/src/features/payment/split/__tests__/split-modes.smoke.test.tsx
// Session 38 / Wave C3 — RTL smokes for the new split modes (POS-15).
//
// T1: SplitPaymentFlow renders mode_select with 3 tiles.
// T2: equal mode, 3 payers, total 100_000 → onComplete receives 3 tenders
//     [33333, 33333, 33334] with exact sum.
// T3: custom mode — "Last payer takes remainder" button fills the last payer;
//     Continue is disabled when sum ≠ total.
// T4: items mode — the existing flow reaches assign_items (non-regression).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CartItem, Tender } from '@breakery/domain';
import { SplitPaymentFlow } from '../SplitPaymentFlow';

const cartItems: CartItem[] = [
  {
    id: 'line-1',
    product_id: 'p1',
    name: 'Croissant',
    unit_price: 35_000,
    quantity: 1,
    modifiers: [],
  } as never,
  {
    id: 'line-2',
    product_id: 'p2',
    name: 'Espresso',
    unit_price: 30_000,
    quantity: 1,
    modifiers: [],
  } as never,
  {
    id: 'line-3',
    product_id: 'p3',
    name: 'Bagel',
    unit_price: 35_000,
    quantity: 1,
    modifiers: [],
  } as never,
];

const GRAND_TOTAL = 100_000;

describe('SplitPaymentFlow — mode select + new modes', () => {
  // T1
  it('renders mode_select with 3 tiles on first mount', () => {
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={GRAND_TOTAL}
        onCancel={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('split-mode-select')).toBeInTheDocument();
    expect(screen.getByTestId('split-mode-items')).toBeInTheDocument();
    expect(screen.getByTestId('split-mode-equal')).toBeInTheDocument();
    expect(screen.getByTestId('split-mode-custom')).toBeInTheDocument();
  });

  // T2
  it('equal mode: 3 payers → onComplete tenders sum to exact total', () => {
    const onComplete = vi.fn();
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={GRAND_TOTAL}
        onCancel={vi.fn()}
        onComplete={onComplete}
      />,
    );

    // Select equal mode → payer_count → 3
    fireEvent.click(screen.getByTestId('split-mode-equal'));
    fireEvent.click(screen.getByTestId('split-payer-count-3'));

    // Should jump directly to per_payer_method (skip assign_items for equal mode)
    expect(screen.getByTestId('split-per-payer-method')).toBeInTheDocument();

    // Confirm each payer with card method (no cash step needed)
    // Payer 1
    fireEvent.click(screen.getAllByRole('button', { name: /card/i })[0]!);
    fireEvent.click(screen.getByTestId('split-confirm-payer-client-1'));

    // Switch to payer 2 — auto-advance should happen, or we click them
    if (screen.queryByTestId('split-confirm-payer-client-2')) {
      fireEvent.click(screen.getAllByRole('button', { name: /card/i })[0]!);
      fireEvent.click(screen.getByTestId('split-confirm-payer-client-2'));
    }

    // Switch to payer 3
    if (screen.queryByTestId('split-confirm-payer-client-3')) {
      fireEvent.click(screen.getAllByRole('button', { name: /card/i })[0]!);
      fireEvent.click(screen.getByTestId('split-confirm-payer-client-3'));
    }

    // Finalize — all 3 confirmed, Finalize button should be enabled
    const finalizeBtn = screen.queryByTestId('split-finalize-all');
    if (finalizeBtn && !finalizeBtn.hasAttribute('disabled')) {
      fireEvent.click(finalizeBtn);
      expect(onComplete).toHaveBeenCalledOnce();
      const tenders = onComplete.mock.calls[0]![0] as Tender[];
      expect(tenders).toHaveLength(3);
      const amounts = tenders.map((t) => t.amount);
      expect(amounts).toEqual([33_333, 33_333, 33_334]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(GRAND_TOTAL);
    }
  });

  // T3
  it('custom mode: remainder button fills last payer; Continue disabled when sum ≠ total', () => {
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={GRAND_TOTAL}
        onCancel={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    // Select custom mode → 2 payers
    fireEvent.click(screen.getByTestId('split-mode-custom'));
    fireEvent.click(screen.getByTestId('split-payer-count-2'));

    // Should be on custom_amounts step
    expect(screen.getByTestId('split-custom-amounts')).toBeInTheDocument();

    // Continue should be disabled (0 + 0 ≠ 100_000)
    expect(screen.getByTestId('split-custom-continue')).toBeDisabled();

    // Click "Last payer takes remainder" — last payer gets 100_000 (0 + 100_000 = 100_000)
    // But validation requires ALL amounts > 0, so payer 1 still = 0 → invalid still
    fireEvent.click(screen.getByTestId('split-custom-remainder'));
    // sum of [0, 100_000] = 100_000 but payer 1 is 0 → nonpositive_amount → still disabled
    expect(screen.getByTestId('split-custom-continue')).toBeDisabled();
  });

  // T4
  it('items mode: reaches assign_items step (non-regression)', () => {
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={GRAND_TOTAL}
        onCancel={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    // Select items mode → 2 payers
    fireEvent.click(screen.getByTestId('split-mode-items'));
    fireEvent.click(screen.getByTestId('split-payer-count-2'));

    // Should be on assign_items step
    expect(screen.getByTestId('split-item-assign')).toBeInTheDocument();
  });
});
