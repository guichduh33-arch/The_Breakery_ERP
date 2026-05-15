// apps/pos/src/features/kds/__tests__/KdsBoard.test.tsx
//
// Session 14 / Phase 3.A — smoke tests for the KDS board orchestrator.
//
// The board is the page-extracted shell: header (Live Orders title + station
// tabs + filter chips) over a responsive grid of KdsOrderCard tiles. We mock
// the data hook (`useKdsOrders`) and the realtime store so we exercise just
// the rendering / grouping / archive logic without touching Supabase.
//
// Refs (docs/Design/backoffice):
//   - `live order.jpg`   — header chrome + station tabs + filter chips.
//   - `live order2.jpg`  — empty / populated grid layouts.
//   - `kds configue.jpg` — thresholds inherited via KdsOrderCard (covered
//     in its own test file).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { KdsBoard } from '../KdsBoard';
import type { KdsItemRow } from '../hooks/useKdsOrders';

// --- Mocks ----------------------------------------------------------------

let mockItems: KdsItemRow[] = [];
let mockIsLoading = false;

vi.mock('../hooks/useKdsOrders', () => ({
  useKdsOrders: () => ({ data: mockItems, isLoading: mockIsLoading }),
}));

// Don't tick — the board rerender loop is irrelevant for these assertions.
vi.mock('../hooks/useAgeTimer', () => ({
  useAgeTimer: () => Date.parse('2026-05-14T12:00:00.000Z'),
}));

// Bump / serve mutations are pulled in by KdsOrderCard.
vi.mock('../hooks/useBumpItem', () => ({
  useBumpItem: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useMarkItemServed', () => ({
  useMarkItemServed: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The store selector pattern needs a callable that returns a per-key value.
const storeState = {
  selectedStation: 'kitchen' as const,
  setStation: vi.fn(),
  kdsStationFilter: 'all' as const,
  setKdsStationFilter: vi.fn(),
};
vi.mock('@/stores/kdsStore', () => ({
  useKdsStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}));

// --- Helpers --------------------------------------------------------------

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function makeItem(overrides: Partial<KdsItemRow> = {}): KdsItemRow {
  return {
    id: 'oi-1',
    order_id: 'ord-1',
    product_id: 'prod-1',
    product_name: 'Americano',
    quantity: 1,
    unit_price: 35000,
    modifiers: [],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'kitchen',
    sent_to_kitchen_at: new Date('2026-05-14T11:59:00.000Z').toISOString(),
    ready_at: null,
    order_number: 'A-001',
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    ...overrides,
  };
}

// --- Tests ----------------------------------------------------------------

describe('KdsBoard', () => {
  beforeEach(() => {
    mockItems = [];
    mockIsLoading = false;
  });

  it('renders the Live Orders header + KDS section label + station tabs', () => {
    render(wrap(<KdsBoard />));

    expect(screen.getByRole('heading', { level: 1, name: /live orders/i })).toBeInTheDocument();
    expect(screen.getByText('KDS')).toBeInTheDocument();
    // Station tabs from KdsStationSelector — the 3 dispatch stations.
    expect(screen.getByRole('tab', { name: /kitchen/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /barista/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /bakery/i })).toBeInTheDocument();
    // Filter chip group from StationFilter.
    expect(screen.getByRole('group', { name: /kds station filter/i })).toBeInTheDocument();
  });

  it('shows the empty state when there are no active tickets', () => {
    mockItems = [];
    render(wrap(<KdsBoard />));
    expect(screen.getByText(/no active tickets/i)).toBeInTheDocument();
  });

  it('renders one card per order and groups items sharing the same order_id', () => {
    mockItems = [
      makeItem({ id: 'oi-1', order_id: 'ord-1', order_number: 'A-001', product_name: 'Americano' }),
      makeItem({ id: 'oi-2', order_id: 'ord-1', order_number: 'A-001', product_name: 'Croissant' }),
      makeItem({ id: 'oi-3', order_id: 'ord-2', order_number: 'A-002', product_name: 'Espresso' }),
    ];

    render(wrap(<KdsBoard />));

    // Two distinct cards (one per order_id).
    expect(screen.getAllByText(/^#A-/)).toHaveLength(2);
    // First order surfaces both items.
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    // Second order present.
    expect(screen.getByText('Espresso')).toBeInTheDocument();
  });

  it('archives ready items older than 5 minutes (D9 client-side auto-archive)', () => {
    mockItems = [
      // Ready 10min ago → should be filtered out (now is 12:00, ready_at 11:50).
      makeItem({
        id: 'oi-old-ready',
        order_id: 'ord-old',
        order_number: 'A-OLD',
        product_name: 'Stale Bagel',
        kitchen_status: 'ready',
        ready_at: new Date('2026-05-14T11:50:00.000Z').toISOString(),
      }),
      // Ready 1min ago → kept.
      makeItem({
        id: 'oi-fresh-ready',
        order_id: 'ord-fresh',
        order_number: 'A-FRESH',
        product_name: 'Hot Croissant',
        kitchen_status: 'ready',
        ready_at: new Date('2026-05-14T11:59:00.000Z').toISOString(),
      }),
    ];

    render(wrap(<KdsBoard />));

    expect(screen.queryByText('Stale Bagel')).not.toBeInTheDocument();
    expect(screen.getByText('Hot Croissant')).toBeInTheDocument();
  });
});
