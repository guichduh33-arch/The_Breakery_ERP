// apps/pos/src/__tests__/table-selector.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { RestaurantTable } from '@breakery/domain';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

const TABLES: RestaurantTable[] = [
  { id: 't1', name: 'T-01', seats: 2, sort_order: 1, is_active: true },
  { id: 't2', name: 'T-02', seats: 2, sort_order: 2, is_active: true },
  { id: 't3', name: 'T-03', seats: 4, sort_order: 3, is_active: true },
];

const fromMock = vi.fn((_table: string) => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      order: vi.fn().mockResolvedValue({ data: TABLES, error: null }),
    })),
  })),
  not: vi.fn(() => ({
    not: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

import { useCartStore } from '@/stores/cartStore';
import { TableSelectorButton } from '@/features/tables/components/TableSelectorButton';
import { buildOrderPayload } from '@breakery/domain';

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('table-selector smoke', () => {
  beforeEach(() => {
    useCartStore.setState({
      cart: { items: [], order_type: 'dine_in' },
      lockedItemIds: [],
      attachedCustomer: null,
    });
  });

  it('shows "Pick table" CTA when no table selected', () => {
    render(wrapper(<TableSelectorButton />));
    expect(screen.getByText(/pick table/i)).toBeInTheDocument();
  });

  it('shows table name after selection', () => {
    useCartStore.setState((s) => ({
      ...s,
      cart: { ...s.cart, tableNumber: 'T-03' },
    }));
    render(wrapper(<TableSelectorButton />));
    expect(screen.getByText(/Table: T-03/i)).toBeInTheDocument();
  });

  it('setTableNumber updates cart store', () => {
    useCartStore.getState().setTableNumber('T-03');
    expect(useCartStore.getState().cart.tableNumber).toBe('T-03');
  });

  it('setTableNumber with null clears the table', () => {
    useCartStore.getState().setTableNumber('T-03');
    useCartStore.getState().setTableNumber(null);
    expect(useCartStore.getState().cart.tableNumber).toBeUndefined();
  });
});

describe('table_number in checkout payload', () => {
  it('buildOrderPayload includes table_number when set', () => {
    const cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] as never[] }],
      order_type: 'dine_in' as const,
      tableNumber: 'T-03',
    };
    const payment = { method: 'cash' as const, amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload.table_number).toBe('T-03');
  });

  it('buildOrderPayload omits table_number when not set', () => {
    const cart = {
      items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 40000, quantity: 1, modifiers: [] as never[] }],
      order_type: 'dine_in' as const,
    };
    const payment = { method: 'cash' as const, amount: 40000, cash_received: 40000, change_given: 0 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect('table_number' in payload).toBe(false);
  });
});
