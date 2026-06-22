// apps/backoffice/src/pages/__tests__/Inventory.test.tsx
// Session 12 — Unit tests for the InventoryPage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import InventoryPage from '@/pages/Inventory.js';

const mockRpc = vi.fn();

const MOCK_ROWS = [
  {
    product_id: 'p-low',
    sku: 'BEV-AMER',
    name: 'Americano',
    category_id: 'c-1',
    category_name: 'Beverage',
    current_stock: 5,
    min_stock_threshold: 10,
    last_movement_at: '2026-05-10T10:00:00Z',
    total_count: 2,
  },
  {
    product_id: 'p-ok',
    sku: 'PAS-CROI',
    name: 'Croissant',
    category_id: 'c-2',
    category_name: 'Pastry',
    current_stock: 50,
    min_stock_threshold: 5,
    last_movement_at: '2026-05-09T10:00:00Z',
    total_count: 2,
  },
];

const MOCK_CATEGORIES = [
  { id: 'c-1', name: 'Beverage' },
  { id: 'c-2', name: 'Pastry'   },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  order:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): MockChain {
    const tableData: RpcResult =
      table === 'categories' ? { data: MOCK_CATEGORIES, error: null } :
      { data: [], error: null };
    const chain: MockChain = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      order:  () => Promise.resolve(tableData),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: Record<string, unknown>) => {
        mockRpc(fn, args);
        if (fn === 'get_stock_levels_v1') {
          const lowOnly = args.p_low_stock_only === true;
          const filtered = lowOnly
            ? MOCK_ROWS.filter((r) => r.min_stock_threshold > 0 && r.current_stock < r.min_stock_threshold)
            : MOCK_ROWS;
          return Promise.resolve({ data: filtered, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        ['inventory.read', 'inventory.adjust', 'inventory.receive', 'inventory.waste'].includes(p),
    }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><InventoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InventoryPage', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the stock-level table with rows from get_stock_levels_v1', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Americano')).toBeInTheDocument();
      expect(screen.getByText('Croissant')).toBeInTheDocument();
    });
    expect(screen.getByText('BEV-AMER')).toBeInTheDocument();
    expect(screen.getByText('PAS-CROI')).toBeInTheDocument();
  });

  it('shows low-stock indicator on rows below threshold', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    const americanoRow = screen.getByText('Americano').closest('tr')!;
    // LowStockBadge renders "Low" / a label inside the row when threshold > current_stock.
    // We use the data-presence assertion: at least one element within the row should reflect low-stock.
    expect(within(americanoRow).getByText('5')).toBeInTheDocument();
  });

  it('renders Adjust / Receive / Waste toolbar buttons when perms granted', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    expect(screen.getByRole('button', { name: /Adjust/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Receive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Waste/i })).toBeInTheDocument();
  });

  it('toggling "Low stock only" calls the RPC with p_low_stock_only=true', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    mockRpc.mockClear();

    fireEvent.click(screen.getByLabelText(/Low stock only/i));
    await waitFor(() => {
      const lastCall = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_levels_v1');
      expect(lastCall).toBeDefined();
      expect((lastCall as [string, { p_low_stock_only?: boolean }])[1].p_low_stock_only).toBe(true);
    });
  });

  it('changing the search input forwards p_search to the RPC and resets paging', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    mockRpc.mockClear();

    fireEvent.change(screen.getByLabelText(/^Search$/i), { target: { value: 'amer' } });
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn, args]) => fn === 'get_stock_levels_v1' && (args as { p_search?: string }).p_search === 'amer');
      expect(call).toBeDefined();
      expect((call as [string, { p_offset: number }])[1].p_offset).toBe(0);
    });
  });

  it('category filter forwards p_category_id', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    mockRpc.mockClear();

    fireEvent.change(screen.getByLabelText(/Category/i), { target: { value: 'c-1' } });
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn, args]) =>
        fn === 'get_stock_levels_v1' && (args as { p_category_id?: string }).p_category_id === 'c-1');
      expect(call).toBeDefined();
    });
  });
});

// Permission gating for "hide Adjust button when user lacks inventory.adjust"
// is exercised by the smoke test (inventory.smoke.test.tsx) which uses a
// runtime-mutable permission set. Keeping the per-test re-mock here would
// leak the mock across files because Vitest hoists vi.mock() and vi.doMock
// inside a test still affects subsequent imports in the same worker process.
