// apps/pos/src/features/display/__tests__/order-type-label.smoke.test.tsx
//
// F-002 regression guard — the customer display must render the REAL DB enum
// value `take_out` as a human label, never the raw snake_case string. Before
// the fix the code compared against the ghost `take_away`, so a real `take_out`
// order fell through to the raw-string branch.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OrderQueueTicker } from '../components/OrderQueueTicker';
import type { DisplayOrder } from '../hooks/useDisplayOrders';

function order(overrides: Partial<DisplayOrder> = {}): DisplayOrder {
  return {
    id: 'o-1',
    order_number: '1001',
    status: 'completed',
    order_type: 'take_out',
    total: 50_000,
    table_number: null,
    paid_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('order type labels use the real DB enum value', () => {
  it('renders a take_out order as "Pickup", not the raw snake_case', () => {
    render(<OrderQueueTicker orders={[order()]} />);
    expect(screen.queryByText('take_out')).not.toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
  });
});
