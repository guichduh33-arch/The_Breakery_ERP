// apps/backoffice/src/pages/reports/__tests__/SalesByCategoryPage.smoke.test.tsx
//
// Audit Reports 2026-08-01, lot E — SalesByCategoryPage etait la SEULE page du
// module sans aucun test (les autres « trous » supposes de l'audit avaient en
// fait leurs smoke tests dans features/reports/__tests__).
//
// Couvre : titre, appel RPC avec les bonnes bornes, lignes de la table, format
// monetaire unifie (lot D / R-15), etat vide canonique, et erreur RPC.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();
let rows: unknown[] = [];
let injectRpcError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_category_v3') {
        return injectRpcError
          ? Promise.resolve({ data: null, error: new Error('RPC error: permission denied') })
          : Promise.resolve({ data: rows, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SalesByCategoryPage from '@/pages/reports/SalesByCategoryPage.js';
import { useAuthStore } from '@/stores/authStore.js';

// recharts' ResponsiveContainer needs ResizeObserver, absent in jsdom.
class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const CATEGORY_ROWS = [
  { category_id: 'c-1', category_name: 'Viennoiserie', total: 2_400_000, qty: 320 },
  { category_id: 'c-2', category_name: 'Boissons',     total:   600_000, qty: 150 },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SalesByCategoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockClear();
  rows = CATEGORY_ROWS;
  injectRpcError = false;
});

describe('SalesByCategoryPage (smoke)', () => {
  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Sales by Category/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_sales_by_category_v3 with ISO date bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_category_v3');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string }])[1];
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders one row per category once data loads', async () => {
    renderPage();
    // Les noms apparaissent dans l'axe du graphe ET dans la table.
    expect((await screen.findAllByText('Viennoiserie')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Boissons').length).toBeGreaterThanOrEqual(1);
  });

  it('formats revenue with the module IDR formatter, not a raw number', async () => {
    renderPage();
    // Audit lot D / R-15 — la table rendait `2400000` via `toLocaleString()`
    // (locale du navigateur, aucune devise). Elle passe par `formatIdrFull`.
    // id-ID insere une insecable apres « Rp », que Testing Library normalise.
    expect(await screen.findByText('Rp 2.400.000')).toBeInTheDocument();
    expect(screen.getByText('Rp 600.000')).toBeInTheDocument();
    expect(screen.queryByText('2400000')).not.toBeInTheDocument();
  });

  it('exposes CSV and PDF exports once data is available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    });
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  it('shows the canonical empty state when there are no sales', async () => {
    rows = [];
    renderPage();
    expect(await screen.findByText('No sales')).toBeInTheDocument();
  });

  it('surfaces a role="alert" element when the RPC fails', async () => {
    injectRpcError = true;
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/RPC error/i);
  });
});
