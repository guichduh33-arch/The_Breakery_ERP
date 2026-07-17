/// <reference types="@testing-library/jest-dom" />
// apps/pos/src/features/heldOrders/__tests__/attach-tab-customer.smoke.test.tsx
//
// Session 62 — Task 5 — "Ardoise" action on a fired counter order in
// HeldOrdersModal. Verifies: the button only renders for pending_payment
// rows, selecting a customer calls attach_tab_customer_v2 with the right
// args, success shows the named-total toast, and a P0011
// credit_limit_exceeded reply surfaces the plafond breakdown in French
// (mock rpc — no live DB).
//
// `CustomerAttachModal` is stubbed (its own search/VKP behavior is covered by
// customer-attach-vkp.smoke.test.tsx) so this test stays focused on the
// attach mutation wiring.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rpc, toastSuccess, toastError } = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock('@/features/cart/CustomerAttachModal', () => ({
  CustomerAttachModal: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (c: { id: string; name: string }) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onSelect({ id: 'cust-1', name: 'Jean Test' })}>
        pick-jean-test
      </button>
    ) : null,
}));

vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({
  useHeldOrdersQuery: () => ({
    data: [
      {
        id: 'order-5',
        order_number: '#0005',
        table_number: null,
        notes: null,
        total: 0,
        created_at: '2026-07-06T10:00:00Z',
        status: 'pending_payment',
        sent_to_kitchen_at: '2026-07-06T09:59:00Z',
      },
      {
        id: 'order-9',
        order_number: 'HELD-x',
        table_number: null,
        notes: null,
        total: 50000,
        created_at: '2026-07-06T10:01:00Z',
        status: 'draft',
        sent_to_kitchen_at: null,
      },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/features/heldOrders/hooks/useReopenHeldOrder', () => ({
  useReopenHeldOrder: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/heldOrders/hooks/useRestoreHeldOrder', () => ({
  useRestoreHeldOrder: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/heldOrders/hooks/useDiscardHeldOrder', () => ({
  useDiscardHeldOrder: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/heldOrders/hooks/useHeldOrdersRealtime', () => ({
  useHeldOrdersRealtime: vi.fn(),
}));

import { HeldOrdersModal } from '@/features/cart/HeldOrdersModal';
import { useCartStore } from '@/stores/cartStore';

function wrap(node: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

const noop = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'take_out' },
    lockedItemIds: [],
    printedItemIds: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
    appliedPromotions: [],
    dismissedPromotionIds: new Set(),
    isOffline: false,
  } as never);
});

describe('AttachTabCustomerButton (via HeldOrdersModal)', () => {
  it('only renders the Ardoise button on the pending_payment row', () => {
    render(wrap(<HeldOrdersModal open onClose={noop} />));
    expect(screen.getAllByLabelText(/attach a named customer to this tab/i)).toHaveLength(1);
  });

  it('calls attach_tab_customer_v2 with the selected customer and shows the named-total toast', async () => {
    rpc.mockResolvedValue({
      data: {
        order_id: 'order-5',
        customer_id: 'cust-1',
        customer_name: 'Jean Test',
        total: 125000,
        outstanding_before: 0,
        credit_limit: 500000,
      },
      error: null,
    });

    render(wrap(<HeldOrdersModal open onClose={noop} />));
    fireEvent.click(screen.getByLabelText(/attach a named customer to this tab/i));
    fireEvent.click(screen.getByText('pick-jean-test'));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('attach_tab_customer_v2', {
        p_order_id: 'order-5',
        p_customer_id: 'cust-1',
      }),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Jean Test')),
    );
  });

  it('surfaces the plafond breakdown on a P0011 credit_limit_exceeded reply', async () => {
    const detail = {
      allowed: false,
      current_outstanding: 300000,
      order_amount: 125000,
      credit_limit: 400000,
      would_exceed_by: 25000,
    };
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0011',
        message: `credit_limit_exceeded: ${JSON.stringify(detail)}`,
        details: JSON.stringify(detail),
      },
    });

    render(wrap(<HeldOrdersModal open onClose={noop} />));
    fireEvent.click(screen.getByLabelText(/attach a named customer to this tab/i));
    fireEvent.click(screen.getByText('pick-jean-test'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = toastError.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/plafond ardoise dépassé/i);
    expect(message).toContain('300,000');
    expect(message).toContain('125,000');
    expect(message).toContain('400,000');
  });
});
