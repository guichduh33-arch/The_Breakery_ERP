// apps/pos/src/features/tablet/__tests__/TabletOrderConfirmation.test.tsx
//
// Ticket 3 (design audit 2026-07-07, Tablet) — after a successful send the
// My Orders screen surfaces a reassuring confirmation banner (resolved order
// number + reassuring copy) and highlights the just-sent card. Display-only.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const orders = [
  {
    id: 'ord-1',
    order_number: '#0042',
    table_number: 'T-07',
    order_type: 'dine_in' as const,
    status: 'pending_payment',
    sent_to_kitchen_at: new Date().toISOString(),
    items: [{ id: 'i1', name: 'Latte', quantity: 1, kitchen_status: 'pending' }],
  },
];

vi.mock('@/features/tablet/hooks/useMyTabletOrders', () => ({
  useMyTabletOrders: () => ({ data: orders, isLoading: false }),
}));
vi.mock('@/features/tablet/hooks/useCancelTabletOrder', () => ({
  useCancelTabletOrder: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock('@/features/tablet/hooks/useTabletOrderStatusListener', () => ({
  useTabletOrderStatusListener: () => undefined,
}));

function wrap(node: ReactNode, state: unknown): ReactNode {
  return <MemoryRouter initialEntries={[{ pathname: '/tablet/orders', state }]}>{node}</MemoryRouter>;
}

describe('TabletOrdersPage — order confirmation (Ticket 3)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the reassuring confirmation with the resolved order number after a send', async () => {
    const { default: TabletOrdersPage } = await import('@/pages/tablet/TabletOrdersPage');
    render(wrap(<TabletOrdersPage />, { justSentOrderId: 'ord-1' }));

    const banner = screen.getByTestId('tablet-order-confirmation');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Order sent to the kitchen');
    expect(banner).toHaveTextContent('#0042');
  });

  it('does not show the confirmation banner on a plain visit (no router state)', async () => {
    const { default: TabletOrdersPage } = await import('@/pages/tablet/TabletOrdersPage');
    render(wrap(<TabletOrdersPage />, undefined));

    expect(screen.queryByTestId('tablet-order-confirmation')).not.toBeInTheDocument();
  });
});
