/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import type { OutstandingOrder } from '@/features/customers/hooks/useOutstandingDebts';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// Real schema: the column is `name_snapshot` (there is no `order_items.name`).
// Mirrors pickup-flow.smoke.test.tsx so this suite catches a 42703-style drift.
const ORDER_ITEMS = [
  { id: 'item-1', product_id: 'p1', name_snapshot: 'Americano', unit_price: 35000, quantity: 1, modifiers: [], is_cancelled: false },
  { id: 'item-2', product_id: 'p2', name_snapshot: 'Croissant', unit_price: 35000, quantity: 1, modifiers: [], is_cancelled: false },
];

const DEBT_ORDER: OutstandingOrder = {
  id: 'order-debt-1',
  order_number: '#D001',
  order_type: 'take_out',
  total: 70000,
  paid: 0,
  due: 70000,
  created_at: new Date().toISOString(),
  days_old: 3,
};

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
  supabaseUrl: 'http://localhost:54321',
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('load-debt-order smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.setState({
      cart: { items: [], order_type: 'take_out' },
      lockedItemIds: [],
      printedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
    });

    mocks.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: ORDER_ITEMS, error: null }),
      })),
    });

    mocks.rpc.mockImplementation((name: string) => {
      if (name === 'get_customer_v3') {
        return Promise.resolve({ data: [{ id: 'cust-1', name: 'Jane Doe' }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('T1: loadDebtOrder loads items (name_snapshot mapping) and locks/prints every line', async () => {
    const { useLoadDebtOrder } = await import('@/features/customers/hooks/useLoadDebtOrder');

    function TestComponent() {
      const { loadDebtOrder } = useLoadDebtOrder();
      return <button onClick={() => void loadDebtOrder(DEBT_ORDER, 'cust-1')}>Load</button>;
    }

    render(wrapper(<TestComponent />));
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => {
      const state = useCartStore.getState();
      expect(state.cart.items).toHaveLength(2);
      expect(state.cart.items.map((i) => i.name)).toEqual(['Americano', 'Croissant']);
      expect(state.lockedItemIds).toEqual(expect.arrayContaining(['item-1', 'item-2']));
      expect(state.printedItemIds).toEqual(expect.arrayContaining(['item-1', 'item-2']));
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/pos');
    });
  });

  it('T2: a B2B order does not render a Pay button (hint to settle in Backoffice instead)', async () => {
    vi.doMock('@/features/customers/hooks/useOutstandingDebts', () => ({
      useOutstandingDebts: () => ({
        data: [
          {
            customer_id: 'cust-1',
            customer_name: 'Acme Corp',
            customer_phone: null,
            credit_limit: 1000000,
            credit_used: 200000,
            total_due: 70000,
            oldest_order_days: 3,
            orders: [{ ...DEBT_ORDER, order_type: 'b2b' }],
          },
        ],
        isLoading: false,
        isError: false,
      }),
    }));

    const { default: CustomerDebtsPanel } = await import('@/features/customers/CustomerDebtsPanel');
    render(wrapper(<CustomerDebtsPanel />));

    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
    expect(screen.getByText(/settle in backoffice/i)).toBeInTheDocument();
  });

  it('T3: after loadDebtOrder, pickedUpOrderId equals order.id', async () => {
    const { useLoadDebtOrder } = await import('@/features/customers/hooks/useLoadDebtOrder');

    function TestComponent() {
      const { loadDebtOrder } = useLoadDebtOrder();
      return <button onClick={() => void loadDebtOrder(DEBT_ORDER, 'cust-1')}>Load</button>;
    }

    render(wrapper(<TestComponent />));
    fireEvent.click(screen.getByRole('button', { name: /load/i }));

    await waitFor(() => {
      expect(useCartStore.getState().pickedUpOrderId).toBe(DEBT_ORDER.id);
    });
  });
});
