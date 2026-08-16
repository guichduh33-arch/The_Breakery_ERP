// apps/backoffice/src/pages/reports/__tests__/PurchasePriceTrendsPage.smoke.test.tsx
//
// « Purchase Price Trends » — ce que la page promet et qui ne doit pas se perdre :
//
//  · LES KPI SE RECALCULENT DEPUIS LES LIGNES de la table (packages/domain) —
//    inflation pondérée par la dépense, comptage hausse/baisse au seuil ±2 %,
//    part de dépense en hausse : la bande ne peut pas diverger de la table ;
//  · LE GRAPHE SUIT LE CLIC — l'article tracé par défaut est la plus forte
//    hausse, et cliquer un article recharge SES points ;
//  · UN ARTICLE SANS PASSÉ se dit « new », jamais « 0 % » ;
//  · LES RÉSERVES SONT AFFICHÉES — prix en unité de base, axe order_date,
//    imports historiques inclus. Ce sont des conditions de lecture.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const SUPPLIER_ROWS = [
  { id: 's1', code: 'ST', name: 'PT Sinar Terang', is_active: true, deleted_at: null },
  { id: 's2', code: 'MJ', name: 'UD Makmur Jaya',  is_active: true, deleted_at: null },
];

// Fixture qui se recoupe : Σ by_product.spend = summary.spend = Σ by_supplier.
// Butter +17,65 % (up) · Flour −0,74 % (flat) · Vanilla sans passé (new).
// Inflation pondérée = (2M×17,65 + 0,6M×−0,74) ÷ 2,6M = +13,4 %.
const TRENDS_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: {
    spend: 3_000_000, spend_prev: 2_700_000,
    po_count: 4, product_count: 3, supplier_count: 2,
  },
  by_product: [
    { product_id: 'p1', name: 'Butter Anchor', base_unit: 'kg', po_count: 3,
      spend: 2_000_000, qty_base: 20, wavg_price: 100_000, wavg_price_prev: 85_000,
      delta_pct: 17.65, min_price: 95_000, max_price: 112_000, last_price: 112_000,
      last_order_date: '2026-06-28', last_supplier: { id: 's1', name: 'PT Sinar Terang' } },
    { product_id: 'p2', name: 'Flour Cakra', base_unit: 'kg', po_count: 2,
      spend: 600_000, qty_base: 44, wavg_price: 13_500, wavg_price_prev: 13_600,
      delta_pct: -0.74, min_price: 13_400, max_price: 13_600, last_price: 13_500,
      last_order_date: '2026-06-20', last_supplier: { id: 's2', name: 'UD Makmur Jaya' } },
    { product_id: 'p3', name: 'Vanilla pods', base_unit: 'g', po_count: 1,
      spend: 400_000, qty_base: 200, wavg_price: 2_000, wavg_price_prev: null,
      delta_pct: null, min_price: 2_000, max_price: 2_000, last_price: 2_000,
      last_order_date: '2026-06-10', last_supplier: { id: 's2', name: 'UD Makmur Jaya' } },
  ],
  by_supplier: [
    { supplier_id: 's1', name: 'PT Sinar Terang', po_count: 3, spend: 2_000_000, share_pct: 66.67 },
    { supplier_id: 's2', name: 'UD Makmur Jaya',  po_count: 1, spend: 1_000_000, share_pct: 33.33 },
  ],
};

const EMPTY_DATA = {
  period:      { start: '2026-06-01', end: '2026-06-30' },
  period_prev: { start: '2026-05-02', end: '2026-05-31' },
  summary: { spend: 0, spend_prev: 0, po_count: 0, product_count: 0, supplier_count: 0 },
  by_product: [],
  by_supplier: [],
};

const POINTS_DATA = {
  period:  { start: '2026-06-01', end: '2026-06-30' },
  product: { id: 'p1', name: 'Butter Anchor', base_unit: 'kg' },
  points: [
    { order_date: '2026-06-01', po_id: 'po1', po_number: 'PO-1', supplier_id: 's1',
      supplier_name: 'PT Sinar Terang', unit_price: 95_000, qty_base: 5 },
    { order_date: '2026-06-15', po_id: 'po2', po_number: 'PO-2', supplier_id: 's2',
      supplier_name: 'UD Makmur Jaya', unit_price: 98_000, qty_base: 5 },
    { order_date: '2026-06-28', po_id: 'po3', po_number: 'PO-3', supplier_id: 's1',
      supplier_name: 'PT Sinar Terang', unit_price: 112_000, qty_base: 10 },
  ],
};

let trendsPayload: unknown = TRENDS_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => {
  function build() {
    const chain = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      or:     () => chain,
      order:  () => Promise.resolve({ data: SUPPLIER_ROWS, error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => build(),
      rpc: (fn: string, args: Record<string, unknown>) => {
        mockRpc(fn, args);
        if (fn === 'get_purchase_price_trends_v1') {
          return Promise.resolve({ data: trendsPayload, error: null });
        }
        if (fn === 'get_purchase_price_points_v1') {
          return Promise.resolve({
            data: { ...POINTS_DATA, product: { ...POINTS_DATA.product, id: args.p_product_id } },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

import PurchasePriceTrendsPage from '@/pages/reports/PurchasePriceTrendsPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-06-01&end=2026-06-30') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/purchase-price-trends${search}`]}>
        <PurchasePriceTrendsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // On seede la permission d'export : ce fichier teste le CÂBLAGE, pas le RBAC.
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  trendsPayload = TRENDS_DATA;
});

describe('PurchasePriceTrendsPage smoke', () => {
  it('renders the heading and the Reports › Purchases breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Purchase Price Trends/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Purchases');
  });

  it('calls the trends RPC with the bounds, and plots the TOP RISER by default', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_purchase_price_trends_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2026-06-01');
      expect(args.p_end_date).toBe('2026-06-30');
    });
    // La plus forte hausse est l'article tracé par défaut.
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_purchase_price_points_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_product_id: string }])[1];
      expect(args.p_product_id).toBe('p1');
    });
  });

  it('derives the KPI band from the table rows — inflation, rising count, exposure', async () => {
    renderPage();
    await screen.findByTestId('kpi-spend');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-spend', 'kpi-inflation', 'kpi-rising', 'kpi-top-riser', 'kpi-rising-spend',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // (2M×17,65 + 0,6M×−0,74) ÷ 2,6M = +13,4 % — pondérée, articles comparables.
    expect(within(band).getByTestId('kpi-inflation')).toHaveTextContent('+13,4%');
    expect(within(band).getByTestId('kpi-inflation')).toHaveTextContent(/2 comparable/);
    // Butter seul franchit ±2 % — Vanilla (new) ne compte ni up ni down.
    expect(within(band).getByTestId('kpi-rising')).toHaveTextContent('1 / 3');
    expect(within(band).getByTestId('kpi-top-riser')).toHaveTextContent('Butter Anchor');
    // 2M sur 3M — la dépense assise sur des prix qui montent.
    expect(within(band).getByTestId('kpi-rising-spend')).toHaveTextContent('66,7%');
  });

  it('states the scope reserves — base unit, order date, historical imports', async () => {
    renderPage();
    await screen.findAllByText('Butter Anchor');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/per base unit/i);
    expect(caveat).toHaveTextContent(/order date/i);
    expect(caveat).toHaveTextContent(/historical imports included/i);
    expect(caveat).toHaveTextContent(/excluding drafts and cancellations/i);
  });

  it('keeps the server ranking (spend desc) and offers column sort as opt-in', async () => {
    renderPage();
    await screen.findAllByText('Butter Anchor');
    const table = within(screen.getByTestId('ppt-article-table')).getByRole('table');
    let rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent ?? '').toMatch(/Butter Anchor/);
    expect(rows[2]?.textContent ?? '').toMatch(/Flour Cakra/);
    // Tri par dernier prix croissant : la vanille (2 000) passe devant.
    fireEvent.click(screen.getByTestId('sort-last'));
    rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent ?? '').toMatch(/Vanilla pods/);
  });

  it('says "new" for an article with no prior-period purchase, never 0%', async () => {
    renderPage();
    await screen.findAllByText('Vanilla pods');
    const table = within(screen.getByTestId('ppt-article-table')).getByRole('table');
    const vanillaRow = within(table).getAllByRole('row')
      .find((r) => (r.textContent ?? '').includes('Vanilla pods'));
    expect(vanillaRow).toBeDefined();
    expect(vanillaRow!).toHaveTextContent('new');
  });

  it('re-plots the clicked article', async () => {
    renderPage();
    await screen.findAllByText('Flour Cakra');
    fireEvent.click(screen.getByTestId('plot-p2'));
    await waitFor(() => {
      const call = mockRpc.mock.calls
        .filter(([fn]) => fn === 'get_purchase_price_points_v1')
        .at(-1);
      expect(call).toBeDefined();
      const args = (call as [string, { p_product_id: string }])[1];
      expect(args.p_product_id).toBe('p2');
    });
  });

  it('renders the supplier Pareto card', async () => {
    renderPage();
    await screen.findAllByText('Butter Anchor');
    expect(screen.getByTestId('chart-supplier-pareto')).toBeInTheDocument();
  });

  it('offers the CSV export, and no PDF (no template registered)', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when nothing was purchased', async () => {
    trendsPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No purchase order line in the selected date range/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ppt-article-table')).toBeNull();
  });
});
