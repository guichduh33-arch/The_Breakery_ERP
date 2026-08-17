// apps/backoffice/src/pages/reports/__tests__/StockPositionPage.smoke.test.tsx
//
// « Stock Position at Date » — ce que la page promet et qui ne doit pas se
// perdre :
//
//  · LA POSITION EST RECONSTRUITE À J — le picker « as of » repart au serveur
//    (p_as_of), et l'absence de date signifie aujourd'hui ;
//  · LA VALORISATION DIT SON NOM — « current WAC » vient du serveur et
//    s'affiche, jamais sous-entendu ;
//  · LES NÉGATIFS NE SONT PAS MASQUÉS — statut 'negative' visible, valeur
//    déduite du total que la table recoupe ;
//  · LA FEUILLE D'INVENTAIRE COMPLÈTE part au CSV.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Fixture qui se recoupe : 200k + 45k − 3k = 242k ; 3 réfs suivies + 1 à zéro.
const REPORT_DATA = {
  as_of: '2026-08-14',
  timezone: 'Asia/Makassar',
  valuation: 'current_wac',
  summary: {
    total_value: 242_000, refs_tracked: 4, refs_in_stock: 2,
    refs_at_zero: 1, refs_negative: 1, refs_below_threshold: 1,
  },
  by_category: [
    { category_id: 'c1', category_name: 'Raw materials', value: 245_000, refs: 3 },
    { category_id: 'c2', category_name: 'Packaging',     value: -3_000,  refs: 1 },
  ],
  products: [
    { product_id: 'p1', name: 'Matcha Powder', sku: 'MP-1', unit: 'cup',
      category_name: 'Raw materials', qty: 10, wac: 20_000, value: 200_000,
      min_threshold: 0, status: 'ok' },
    { product_id: 'p2', name: 'Flour T55', sku: 'FL-1', unit: 'kg',
      category_name: 'Raw materials', qty: 30, wac: 1_500, value: 45_000,
      min_threshold: 50, status: 'below_threshold' },
    { product_id: 'p3', name: 'Vanilla', sku: 'VA-1', unit: 'kg',
      category_name: 'Raw materials', qty: 0, wac: 400_000, value: 0,
      min_threshold: 2, status: 'at_zero' },
    { product_id: 'p4', name: 'Pastry Boxes', sku: 'BX-1', unit: 'pcs',
      category_name: 'Packaging', qty: -3, wac: 1_000, value: -3_000,
      min_threshold: 0, status: 'negative' },
  ],
};

const EMPTY_DATA = {
  as_of: '2026-08-14',
  timezone: 'Asia/Makassar',
  valuation: 'current_wac',
  summary: {
    total_value: 0, refs_tracked: 0, refs_in_stock: 0,
    refs_at_zero: 0, refs_negative: 0, refs_below_threshold: 0,
  },
  by_category: [],
  products: [],
};

let reportPayload: unknown = REPORT_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_stock_position_v1') {
        return Promise.resolve({ data: reportPayload, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import StockPositionPage from '@/pages/reports/StockPositionPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/stock-position${search}`]}>
        <StockPositionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // On seede la permission d'export : ce fichier teste le CÂBLAGE, pas le RBAC.
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  reportPayload = REPORT_DATA;
});

describe('StockPositionPage smoke', () => {
  it('renders the heading and the Reports › Inventory breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Stock Position at Date/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Inventory');
  });

  it('calls get_stock_position_v1 without args when no date is picked', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_position_v1');
      expect(call).toBeDefined();
      expect((call as [string, Record<string, unknown>])[1]).toEqual({});
    });
  });

  it('passes the picked as_of date down to the RPC', async () => {
    renderPage('?as_of=2026-08-14');
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_position_v1');
      expect(call).toBeDefined();
      expect((call as [string, { p_as_of: string }])[1]).toEqual({ p_as_of: '2026-08-14' });
    });
    expect(screen.getByTestId('as-of-picker')).toHaveValue('2026-08-14');
  });

  it('shows the snapshot band: value at current WAC, refs, statuses', async () => {
    renderPage();
    await screen.findByTestId('kpi-value');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-value', 'kpi-in-stock', 'kpi-below', 'kpi-zero', 'kpi-negative']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-value')).toHaveTextContent(/242 rb/);
    expect(within(band).getByTestId('kpi-value')).toHaveTextContent(/current WAC/i);
    expect(within(band).getByTestId('kpi-in-stock')).toHaveTextContent('2');
    expect(within(band).getByTestId('kpi-negative')).toHaveTextContent(/investigate/i);
  });

  it('states the reconstruction and valuation reserve', async () => {
    renderPage();
    await screen.findByTestId('kpi-value');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/Rebuilt backwards/i);
    expect(caveat).toHaveTextContent(/current.*WAC/i);
    expect(caveat).toHaveTextContent(/never hidden/i);
  });

  it('lists the inventory sheet with statuses and a product drill-down', async () => {
    renderPage();
    await screen.findAllByText('Matcha Powder');
    const panel = screen.getByTestId('stock-position-table');
    expect(panel).toHaveTextContent('below threshold');
    expect(panel).toHaveTextContent('at zero');
    expect(panel).toHaveTextContent('negative');
    expect(within(panel).getByRole('link', { name: 'Matcha Powder' }))
      .toHaveAttribute('href', expect.stringContaining('/backoffice/products'));
  });

  it('closes the category breakdown on the band total', async () => {
    renderPage();
    await screen.findAllByText('Matcha Powder');
    const card = screen.getByTestId('breakdown-categories');
    expect(card).toHaveTextContent(/242 rb/);
    expect(card).toHaveTextContent('Raw materials');
  });

  it('offers the CSV export of the full sheet, and no PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when nothing is tracked', async () => {
    reportPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No inventory-tracked product/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('stock-position-table')).toBeNull();
  });
});
