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
    track_inventory: true,
    unit: 'pcs',
    stock_value: 25_000,
    last_movement_at: '2026-05-10T10:00:00Z',
  },
  {
    product_id: 'p-ok',
    sku: 'PAS-CROI',
    name: 'Croissant',
    category_id: 'c-2',
    category_name: 'Pastry',
    current_stock: 50,
    min_stock_threshold: 5,
    track_inventory: true,
    unit: 'pcs',
    stock_value: 500_000,
    last_movement_at: '2026-05-09T10:00:00Z',
  },
];

// ADR-024 déc. 1-2 — les compteurs viennent du serveur et portent sur tout le
// périmètre filtré. `low_count: 7` est volontairement INCOHÉRENT avec les deux
// lignes du jeu d'essai : c'est ce qui prouve que la tuile lit bien le serveur
// et non un comptage de la page affichée.
const MOCK_COUNTERS = {
  total_count: 42, low_count: 7, zero_count: 3, negative_count: 1, untracked_count: 9,
};

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
        if (fn === 'get_stock_levels_v3') {
          const filtered = args.p_bucket === 'low'
            ? MOCK_ROWS.filter((r) => r.min_stock_threshold > 0 && r.current_stock < r.min_stock_threshold)
            : MOCK_ROWS;
          return Promise.resolve({ data: filtered, error: null });
        }
        if (fn === 'get_stock_counters_v1') {
          return Promise.resolve({ data: [MOCK_COUNTERS], error: null });
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
        // Q3 audit 2026-07-27 : le bouton Receive est gaté purchasing.po.create
        // (navigation vers l'achat direct compté), plus inventory.receive.
        ['inventory.read', 'inventory.adjust', 'purchasing.po.create', 'inventory.waste'].includes(p),
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

  it('renders the stock-level table with rows from get_stock_levels_v3', async () => {
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

  // ADR-024 déc. 1 — archétype LIST : les compteurs SONT les filtres. Un KPI se
  // lit, un compteur se clique.
  it('clicking the "Low stock" counter calls the rows RPC with p_bucket=low', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    mockRpc.mockClear();

    fireEvent.click(screen.getByTestId('counter-low'));
    await waitFor(() => {
      const lastCall = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_levels_v3');
      expect(lastCall).toBeDefined();
      expect((lastCall as [string, { p_bucket?: string }])[1].p_bucket).toBe('low');
    });
  });

  it('marks the clicked counter as pressed and resets paging', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));

    expect(screen.getByTestId('counter-all')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('counter-negative'));
    await waitFor(() => {
      expect(screen.getByTestId('counter-negative')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('counter-all')).toHaveAttribute('aria-pressed', 'false');
    });
    const call = mockRpc.mock.calls.find(([fn, args]) =>
      fn === 'get_stock_levels_v3' && (args as { p_bucket?: string }).p_bucket === 'negative');
    expect((call as [string, { p_offset: number }])[1].p_offset).toBe(0);
  });

  // ADR-024 déc. 2 — les compteurs n'appliquent JAMAIS le panier actif, sinon la
  // bande ne pourrait plus annoncer que le panier déjà sélectionné et cesserait
  // d'être un moyen d'en changer.
  it('never forwards the active bucket to the counters RPC', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    mockRpc.mockClear();

    fireEvent.click(screen.getByTestId('counter-low'));
    await waitFor(() => {
      expect(mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_levels_v3')).toBeDefined();
    });
    for (const [fn, args] of mockRpc.mock.calls) {
      if (fn === 'get_stock_counters_v1') {
        expect(args).not.toHaveProperty('p_bucket');
      }
    }
  });

  // ADR-024 déc. 1 — le compteur lit le serveur, pas les lignes affichées.
  // MOCK_COUNTERS.low_count vaut 7 alors que la page ne rend qu'une seule ligne
  // sous seuil : si le compteur affichait 1, il mentirait.
  it('shows the server-side low-stock count, not the count of rendered rows', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    expect(within(screen.getByTestId('counter-low')).getByText('7')).toBeInTheDocument();
  });

  // ADR-024 déc. 1 — le pied compte le panier affiché, jamais la page.
  it('footer counts the active bucket, not the rendered page', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    // 2 lignes rendues, 42 au total dans le panier « all ».
    expect(screen.getByText('2 of 42')).toBeInTheDocument();
  });

  it('changing the search input forwards p_search to the RPC and resets paging', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Americano'));
    mockRpc.mockClear();

    fireEvent.change(screen.getByLabelText(/^Search$/i), { target: { value: 'amer' } });
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn, args]) => fn === 'get_stock_levels_v3' && (args as { p_search?: string }).p_search === 'amer');
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
        fn === 'get_stock_levels_v3' && (args as { p_category_id?: string }).p_category_id === 'c-1');
      expect(call).toBeDefined();
    });
  });
});

// Permission gating for "hide Adjust button when user lacks inventory.adjust"
// is exercised by the smoke test (inventory.smoke.test.tsx) which uses a
// runtime-mutable permission set. Keeping the per-test re-mock here would
// leak the mock across files because Vitest hoists vi.mock() and vi.doMock
// inside a test still affects subsequent imports in the same worker process.
