// apps/pos/src/__tests__/kds-served.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

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
  orders: { order_number: string };
}

let fixtureRows: FixtureItem[] = [];
// Use vi.hoisted so the mock object is available in the vi.mock factory (which is hoisted).
const { mockRpc, mockFrom, mockChannel } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockChannel = vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }));
  const mockFrom = vi.fn((_table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn().mockImplementation(() => {
              return Promise.resolve({ data: fixtureRows, error: null });
            }),
          })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
      not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  }));
  return { mockRpc, mockFrom, mockChannel };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    channel: mockChannel,
    removeChannel: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

import KdsPage from '@/pages/Kds';
import { useKdsStore } from '@/stores/kdsStore';

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('kds-served smoke', () => {
  beforeEach(() => {
    fixtureRows = [];
    mockFrom.mockClear();
    mockRpc.mockClear();
    mockChannel.mockClear();
    useKdsStore.setState({ selectedStation: 'kitchen' });
  });

  it('shows "Mark Served" button for a ready item', async () => {
    fixtureRows = [
      {
        id: 'item-ready-1',
        order_id: 'order-1',
        product_id: 'prod-1',
        quantity: 1,
        unit_price: 35000,
        modifiers: [],
        modifiers_total: 0,
        kitchen_status: 'ready',
        dispatch_station: 'kitchen',
        sent_to_kitchen_at: new Date().toISOString(),
        ready_at: new Date().toISOString(),
        products: { name: 'Americano' },
        orders: { order_number: 'A-001' },
      },
    ];

    render(wrapper(<KdsPage />));
    expect(await screen.findByRole('button', { name: /mark served/i })).toBeInTheDocument();
  });

  it('tapping Mark Served fires rpc mark_item_served with item id', async () => {
    mockRpc.mockResolvedValue({ data: {}, error: null });
    fixtureRows = [
      {
        id: 'item-ready-1',
        order_id: 'order-1',
        product_id: 'prod-1',
        quantity: 1,
        unit_price: 35000,
        modifiers: [],
        modifiers_total: 0,
        kitchen_status: 'ready',
        dispatch_station: 'kitchen',
        sent_to_kitchen_at: new Date().toISOString(),
        ready_at: new Date().toISOString(),
        products: { name: 'Americano' },
        orders: { order_number: 'A-001' },
      },
    ];

    render(wrapper(<KdsPage />));
    const btn = await screen.findByRole('button', { name: /mark served/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('mark_item_served', { p_item_id: 'item-ready-1' });
    });
  });

  it('shows toast error when rpc returns P0011', async () => {
    const { toast } = await import('sonner');
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0011', message: 'Item must be ready before serving' } });
    fixtureRows = [
      {
        id: 'item-not-ready',
        order_id: 'order-2',
        product_id: 'prod-2',
        quantity: 1,
        unit_price: 30000,
        modifiers: [],
        modifiers_total: 0,
        kitchen_status: 'ready',
        dispatch_station: 'kitchen',
        sent_to_kitchen_at: new Date().toISOString(),
        ready_at: null,
        products: { name: 'Latte' },
        orders: { order_number: 'A-002' },
      },
    ];

    render(wrapper(<KdsPage />));
    const btn = await screen.findByRole('button', { name: /mark served/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not mark served — item must be ready first');
    });
  });

  it('does not show Mark Served for pending items', async () => {
    fixtureRows = [
      {
        id: 'item-pending-1',
        order_id: 'order-3',
        product_id: 'prod-3',
        quantity: 1,
        unit_price: 35000,
        modifiers: [],
        modifiers_total: 0,
        kitchen_status: 'pending',
        dispatch_station: 'kitchen',
        sent_to_kitchen_at: new Date().toISOString(),
        ready_at: null,
        products: { name: 'Espresso' },
        orders: { order_number: 'A-003' },
      },
    ];

    render(wrapper(<KdsPage />));
    await screen.findByText('Espresso');
    expect(screen.queryByRole('button', { name: /mark served/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });
});
