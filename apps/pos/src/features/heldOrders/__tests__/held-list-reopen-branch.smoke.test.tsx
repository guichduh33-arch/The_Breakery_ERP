/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { reopenMutate, restoreMutate } = vi.hoisted(() => ({
  reopenMutate: vi.fn().mockResolvedValue('order-5'),
  restoreMutate: vi.fn().mockResolvedValue('order-9'),
}));

vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({
  useHeldOrdersQuery: () => ({
    data: [
      { id: 'order-5', order_number: '#0005', table_number: '7', notes: null, total: 0, created_at: '2026-06-25T10:00:00Z', status: 'pending_payment', sent_to_kitchen_at: '2026-06-25T09:59:00Z' },
      { id: 'order-9', order_number: 'HELD-x', table_number: null, notes: null, total: 50000, created_at: '2026-06-25T10:01:00Z', status: 'draft', sent_to_kitchen_at: null },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/features/heldOrders/hooks/useReopenHeldOrder', () => ({ useReopenHeldOrder: () => ({ mutateAsync: reopenMutate }) }));
vi.mock('@/features/heldOrders/hooks/useRestoreHeldOrder', () => ({ useRestoreHeldOrder: () => ({ mutateAsync: restoreMutate }) }));
vi.mock('@/features/heldOrders/hooks/useDiscardHeldOrder', () => ({ useDiscardHeldOrder: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/features/heldOrders/hooks/useHeldOrdersRealtime', () => ({ useHeldOrdersRealtime: () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HeldOrdersModal } from '@/features/cart/HeldOrdersModal';
import { useCartStore } from '@/stores/cartStore';

function wrap(n: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [], printedItemIds: [], attachedCustomer: null,
    pickedUpOrderId: null, appliedPromotions: [], dismissedPromotionIds: new Set(), isOffline: false,
  } as never);
});

describe('HeldOrdersModal — draft vs sent branch', () => {
  it('routes a sent (pending_payment) order to reopen', async () => {
    render(wrap(<HeldOrdersModal open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /restore held order #0005/i }));
    await waitFor(() => expect(reopenMutate).toHaveBeenCalledWith('order-5'));
    expect(restoreMutate).not.toHaveBeenCalled();
  });

  it('routes a draft order to restore', async () => {
    render(wrap(<HeldOrdersModal open onClose={() => {}} />));
    fireEvent.click(screen.getByRole('button', { name: /restore held order HELD-x/i }));
    await waitFor(() => expect(restoreMutate).toHaveBeenCalledWith('order-9'));
    expect(reopenMutate).not.toHaveBeenCalled();
  });

  it('shows a Sent badge for fired orders and a Draft badge for drafts', () => {
    render(wrap(<HeldOrdersModal open onClose={() => {}} />));
    expect(screen.getByText(/sent/i)).toBeInTheDocument();
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
  });
});
