// apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx
//
// Session 13 / Phase 4.C.
//
// Unit tests for OrderQueueTicker — verifies the 5-row clamp + empty state.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OrderQueueTicker } from '../components/OrderQueueTicker';
import type { DisplayOrder } from '../hooks/useDisplayOrders';

function fakeOrder(n: number, overrides: Partial<DisplayOrder> = {}): DisplayOrder {
  return {
    id: `o-${n}`,
    order_number: String(1000 + n),
    status: 'paid',
    order_type: 'dine_in',
    total: 50_000,
    table_number: String(n),
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('OrderQueueTicker', () => {
  it('renders the empty state when orders is empty', () => {
    render(<OrderQueueTicker orders={[]} />);
    expect(screen.getByTestId('display-queue-empty')).toBeInTheDocument();
    expect(screen.getByText('Awaiting orders')).toBeInTheDocument();
  });

  it('clamps to 5 rows even when given 7 orders', () => {
    const orders = Array.from({ length: 7 }, (_, i) => fakeOrder(i + 1));
    render(<OrderQueueTicker orders={orders} />);

    const rows = screen.getAllByTestId('display-queue-row');
    expect(rows).toHaveLength(5);

    // First 5 rendered in order (the slice does not reverse the array).
    expect(rows[0]).toHaveTextContent('#1001');
    expect(rows[4]).toHaveTextContent('#1005');
  });

  it('shows a "Ready" pill for completed orders and order_type label', () => {
    const orders = [
      fakeOrder(1, { status: 'completed', order_type: 'take_out', table_number: null }),
      fakeOrder(2, { status: 'paid', order_type: 'dine_in', table_number: '12' }),
    ];
    render(<OrderQueueTicker orders={orders} />);

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.getByText('Table 12')).toBeInTheDocument();
  });

  it('accepts a custom emptyText prop', () => {
    render(<OrderQueueTicker orders={[]} emptyText="No orders yet" />);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });
});
