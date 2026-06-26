// apps/pos/src/__tests__/kds.smoke.test.tsx
//
// Session 2 — KDS smoke test.
// Mocks the Supabase client to avoid network and asserts:
//   1. Empty state renders when there are no active tickets
//   2. A ticket renders for a single fetched item with modifiers
//   3. Tapping "Start" fires the bump mutation with `{from: pending, to: preparing}`

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface FixtureItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  modifiers: { group_name: string; option_label: string; price_adjustment: number }[];
  modifiers_total: number;
  kitchen_status: 'pending' | 'preparing' | 'ready';
  dispatch_station: 'kitchen' | 'barista' | 'display' | 'none';
  sent_to_kitchen_at: string;
  ready_at: string | null;
  products: { name: string };
  orders: { order_number: string; status: string };
}

let fixtureRows: FixtureItem[] = [];

const updateMock = vi.fn((_payload: Record<string, unknown>) => ({
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

const fromMock = vi.fn((_table: string) => ({
  select: vi.fn(() => ({
    // Spec B-1 Ph2: useKdsOrders now uses .or() instead of .eq() as first filter.
    or: vi.fn(() => ({
      in: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: fixtureRows, error: null }),
        })),
      })),
    })),
  })),
  update: updateMock,
}));

const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// Import AFTER the mock so the module under test picks the mocked client.
import KdsPage from '@/pages/Kds';
import { useKdsStore } from '@/stores/kdsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KDS smoke', () => {
  beforeEach(() => {
    fixtureRows = [];
    fromMock.mockClear();
    updateMock.mockClear();
    channelMock.on.mockClear();
    channelMock.subscribe.mockClear();
    useKdsStore.setState({ selectedStation: 'kitchen' });
  });

  it('shows empty state when there are no active tickets', async () => {
    render(wrapper(<KdsPage />));
    expect(
      await screen.findByText(/no active tickets/i),
    ).toBeInTheDocument();
  });

  it('renders a tile for a fetched item', async () => {
    fixtureRows = [
      {
        id: 'item-1',
        order_id: 'order-1',
        product_id: 'prod-1',
        quantity: 2,
        unit_price: 35000,
        modifiers: [
          { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
          { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
        ],
        modifiers_total: 10000,
        kitchen_status: 'pending',
        dispatch_station: 'kitchen',
        sent_to_kitchen_at: new Date().toISOString(),
        ready_at: null,
        products: { name: 'Americano' },
        orders: { order_number: '#A-001', status: 'pending_payment' },
      },
    ];

    render(wrapper(<KdsPage />));
    expect(await screen.findByText('Americano')).toBeInTheDocument();
    expect(screen.getByText(/#A-001/)).toBeInTheDocument();
    expect(screen.getByText(/Oat milk/)).toBeInTheDocument();
  });

  it('fires bump mutation with pending→preparing when Start is tapped', async () => {
    fixtureRows = [
      {
        id: 'item-42',
        order_id: 'order-42',
        product_id: 'prod-1',
        quantity: 1,
        unit_price: 35000,
        modifiers: [],
        modifiers_total: 0,
        kitchen_status: 'pending',
        dispatch_station: 'kitchen',
        sent_to_kitchen_at: new Date().toISOString(),
        ready_at: null,
        products: { name: 'Croissant' },
        orders: { order_number: '#B-007', status: 'pending_payment' },
      },
    ];

    render(wrapper(<KdsPage />));
    const startBtn = await screen.findByRole('button', { name: /start/i });

    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    const firstCall = updateMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const updatePayload = firstCall?.[0];
    expect(updatePayload).toBeDefined();
    expect(updatePayload?.kitchen_status).toBe('preparing');
    // pending→preparing should NOT set ready_at
    expect(updatePayload?.ready_at).toBeUndefined();
  });
});
