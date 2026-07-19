// apps/pos/src/__tests__/kds.smoke.test.tsx
//
// Session 2 — KDS smoke test.
// Mocks the Supabase client to avoid network and asserts:
//   1. Empty state renders when there are no active tickets
//   2. A ticket renders for a single fetched item with modifiers
//   3. Tapping "Start" calls the `kds_start_prep_timer_v1` RPC
//
// Session 59 (04 D1.1) — "Start" now goes through the server RPC
// `kds_start_prep_timer_v1` (sets `order_items.prep_started_at` and
// transitions pending→preparing atomically) instead of a raw table PATCH.
// Assertion 3 was updated accordingly (was: raw `.update()` call).

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

// Session 59 — useKdsServedOrders (recall strip) queries the same table via
// .select().or().eq().gte().order(); return an empty result down that path
// so it never crashes the render (the strip just stays hidden).
const servedOrdersChain = {
  gte: vi.fn(() => ({
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
};

const fromMock = vi.fn((_table: string) => ({
  select: vi.fn(() => ({
    // Spec B-1 Ph2: useKdsOrders now uses .or() instead of .eq() as first filter.
    or: vi.fn(() => ({
      in: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: fixtureRows, error: null }),
        })),
      })),
      // useKdsServedOrders shape: .or().eq('kitchen_status', 'served').gte(...).order(...)
      eq: vi.fn(() => servedOrdersChain),
    })),
  })),
  update: updateMock,
}));

const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: Record<string, unknown>) => rpcMock(fn, args) as unknown,
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// Import AFTER the mock so the module under test picks the mocked client.
import KdsPage from '@/pages/Kds';
import { useKdsStore } from '@/stores/kdsStore';
import { usePosSettingsStore } from '@/stores/posSettingsStore';

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
    rpcMock.mockClear();
    channelMock.on.mockClear();
    channelMock.subscribe.mockClear();
    useKdsStore.setState({ selectedStation: 'kitchen' });
    usePosSettingsStore.setState({ deviceCode: '' });
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

  it('calls kds_start_prep_timer_v1 when Start is tapped', async () => {
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
      expect(rpcMock).toHaveBeenCalledWith('kds_start_prep_timer_v1', {
        p_order_item_id: 'item-42',
      });
    });

    // The RPC (not a raw table PATCH) owns the pending→preparing transition now.
    expect(updateMock).not.toHaveBeenCalled();
  });

  // Session 59 (21 D1.1) — useLanHeartbeat is now mounted on this shell so BO
  // "LAN Devices" can see the KDS screen as online.
  it('emits a LAN heartbeat when a device code is configured', async () => {
    usePosSettingsStore.setState({ deviceCode: 'KDS-KITCHEN-01' });

    render(wrapper(<KdsPage />));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('update_lan_heartbeat_v2', {
        p_device_codes: ['KDS-KITCHEN-01'],
      });
    });
  });

  it('does not emit a heartbeat when no device code is configured', async () => {
    render(wrapper(<KdsPage />));
    await screen.findByText(/no active tickets/i);

    expect(rpcMock).not.toHaveBeenCalledWith(
      'update_lan_heartbeat_v2',
      expect.anything(),
    );
  });
});
