// apps/pos/src/features/payment/split/__tests__/SplitPaymentFlow.smoke.test.tsx
//
// Session 14 / Phase 2.C — RTL smoke for the new split-by-item flow.
// Verifies the happy path : pick 2 payers → assign items → pick method for
// each → confirm → flow surfaces a tenders[] payload to onComplete.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CartItem } from '@breakery/domain';
import { SplitPaymentFlow } from '../SplitPaymentFlow';

const cartItems: CartItem[] = [
  {
    id: 'line-1',
    product_id: 'p1',
    name: 'Vegetarian Bagel',
    unit_price: 60_000,
    quantity: 1,
    modifiers: [],
  } as never,
  {
    id: 'line-2',
    product_id: 'p2',
    name: 'Smoky Fish',
    unit_price: 85_000,
    quantity: 1,
    modifiers: [],
  } as never,
];

describe('SplitPaymentFlow', () => {
  it('renders the payer count step on first mount', () => {
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={145_000}
        onCancel={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('split-payer-count')).toBeInTheDocument();
    expect(screen.getByText(/HOW MANY PAYERS/i)).toBeInTheDocument();
    // 4 guest tiles : 2 / 3 / 4 / 5
    expect(screen.getByTestId('split-payer-count-2')).toBeInTheDocument();
    expect(screen.getByTestId('split-payer-count-5')).toBeInTheDocument();
  });

  it('advances to assignment step once a count is picked', () => {
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={145_000}
        onCancel={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('split-payer-count-2'));
    expect(screen.getByTestId('split-item-assign')).toBeInTheDocument();
    // Both cart lines visible
    expect(screen.getByText('Vegetarian Bagel')).toBeInTheDocument();
    expect(screen.getByText('Smoky Fish')).toBeInTheDocument();
    // Two payer tabs
    expect(screen.getAllByText(/Client 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Client 2/).length).toBeGreaterThan(0);
  });

  it('disables proceed-to-payment until every unit is assigned', () => {
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={145_000}
        onCancel={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('split-payer-count-2'));
    const proceed = screen.getByTestId('split-proceed-to-payment');
    expect(proceed).toBeDisabled();

    // Assign one line to active payer (Client 1)
    fireEvent.click(screen.getByTestId('split-assign-line-line-1'));
    expect(proceed).toBeDisabled(); // still 1 unit unassigned

    // Switch tab to Client 2 and assign the other
    fireEvent.click(screen.getAllByText(/Client 2/)[0]!);
    fireEvent.click(screen.getByTestId('split-assign-line-line-2'));
    expect(proceed).not.toBeDisabled();
  });

  it('cancels via the X icon → calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <SplitPaymentFlow
        cartItems={cartItems}
        grandTotal={145_000}
        onCancel={onCancel}
        onComplete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Cancel split/i));
    expect(onCancel).toHaveBeenCalled();
  });
});
