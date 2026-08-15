// apps/backoffice/src/pages/reports/__tests__/SalesByProductPage.smoke.test.tsx
//
// « Sales by Product » — ce que la page promet et qui ne doit pas se perdre :
//
//  · LE CLASSEMENT SERVEUR est l'état nul de la table (CA décroissant), et le
//    tri de colonne est opt-in ;
//  · LES RÉSERVES SONT AFFICHÉES — remise non attribuable, composant de combo
//    non compté, remboursement non déduit. Ce sont des conditions de lecture,
//    pas des notes ;
//  · LA VENTILATION PAR CANAL existe (c'est l'écart assumé avec le rapport POS
//    « Top products », qui exclut le B2B) ;
//  · LE DRILL-DOWN OUVRE LES LIGNES du produit cliqué, et son pied totalise le
//    JEU COMPLET, pas la page chargée.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const CATEGORY_ROWS = [
  { id: 'c1', name: 'Bread', slug: 'bread', sort_order: 1, is_active: true,
    dispatch_station: '', kds_station: '', show_in_pos: true, category_type: 'finished' },
];

const SALES_DATA = {
  period: { start: '2026-06-01', end: '2026-06-30' },
  summary: {
    revenue: 3_000_000, qty: 300, discount: 50_000, lines: 12, orders: 9, products: 2,
    avg_price: 10_000,
    counter: { qty: 250, revenue: 2_000_000 },
    b2b:     { qty: 50,  revenue: 1_000_000 },
    unattributed: { order_discount: 120_000, promotion_total: 30_000 },
  },
  // Servi trié par CA décroissant, comme la RPC.
  by_product: [
    { product_id: 'p2', name: 'Croissant', category_id: 'c1', category_name: 'Bread',
      qty: 200, revenue: 2_000_000, discount: 50_000, order_count: 7, avg_price: 10_000,
      share_pct: 66.67, counter: { qty: 200, revenue: 2_000_000 }, b2b: { qty: 0, revenue: 0 } },
    { product_id: 'p1', name: 'Baguette', category_id: 'c1', category_name: 'Bread',
      qty: 100, revenue: 1_000_000, discount: 0, order_count: 4, avg_price: 10_000,
      share_pct: 33.33, counter: { qty: 50, revenue: 0 }, b2b: { qty: 50, revenue: 1_000_000 } },
  ],
};

const EMPTY_DATA = {
  period: { start: '2026-06-01', end: '2026-06-30' },
  summary: {
    revenue: 0, qty: 0, discount: 0, lines: 0, orders: 0, products: 0, avg_price: 0,
    counter: { qty: 0, revenue: 0 }, b2b: { qty: 0, revenue: 0 },
    unattributed: { order_discount: 0, promotion_total: 0 },
  },
  by_product: [],
};

// 2 lignes servies sur 5 au total : le pied doit dire le TOTAL, pas la page.
const LINES_DATA = {
  product_id: 'p2',
  period: { start: '2026-06-01', end: '2026-06-30' },
  lines: [
    { id: 'l1', sold_at: '2026-06-30T09:15:00+08:00', order_id: 'o9', order_number: '#0004',
      customer_id: null, customer_name: null, channel: 'counter', served_by_name: 'Mamat',
      name_snapshot: 'Croissant', quantity: 2, unit_price: 10_000, modifiers_total: 0,
      discount_amount: 5_000, discount_reason: 'Staff', line_total: 15_000 },
    { id: 'l2', sold_at: '2026-06-29T08:02:00+08:00', order_id: 'o8', order_number: '#0011',
      customer_id: 'cu1', customer_name: 'Warung Sari', channel: 'b2b', served_by_name: 'Mamat',
      name_snapshot: 'Croissant classique', quantity: 10, unit_price: 9_000, modifiers_total: 0,
      discount_amount: 0, discount_reason: null, line_total: 90_000 },
  ],
  totals: {
    lines: 5, orders: 4, qty: 200, revenue: 2_000_000, discount: 50_000,
    counter_qty: 200, b2b_qty: 0,
  },
  next_cursor: null,
};

let salesPayload: unknown = SALES_DATA;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => {
  function build() {
    const chain = {
      select: () => chain,
      is:     () => chain,
      order:  () => Promise.resolve({ data: CATEGORY_ROWS, error: null }),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => build(),
      rpc: (fn: string, args: Record<string, unknown>) => {
        mockRpc(fn, args);
        if (fn === 'get_sales_by_product_v1') {
          return Promise.resolve({ data: salesPayload, error: null });
        }
        if (fn === 'get_product_sales_lines_v1') {
          return Promise.resolve({ data: LINES_DATA, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

import SalesByProductPage from '@/pages/reports/SalesByProductPage.js';
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
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-product${search}`]}>
        <SalesByProductPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // On seede la permission d'export : ce fichier teste le CÂBLAGE, pas le RBAC.
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  salesPayload = SALES_DATA;
});

describe('SalesByProductPage smoke', () => {
  it('renders the heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Sales by Product/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Sales');
  });

  it('calls get_sales_by_product_v1 with the business-day bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_product_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2026-06-01');
      expect(args.p_end_date).toBe('2026-06-30');
    });
  });

  it('keeps the server ranking (revenue desc) as the table default order', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    const table = within(screen.getByTestId('sbp-product-detail')).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent ?? '').toMatch(/Croissant/);
    expect(rows[2]?.textContent ?? '').toMatch(/Baguette/);
  });

  it('sorts by product name on demand, and the server order is opt-out', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    fireEvent.click(screen.getByTestId('sort-name'));
    const table = within(screen.getByTestId('sbp-product-detail')).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent ?? '').toMatch(/Baguette/);
  });

  it('states the scope reserves, including the discounts it cannot attribute', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    const caveat = screen.getByTestId('scope-caveat');
    expect(caveat).toHaveTextContent(/net of line discounts/i);
    // 120 000 + 30 000 — remise de commande + promo, non ventilables.
    expect(caveat).toHaveTextContent(/150\.000/);
    expect(caveat).toHaveTextContent(/combo/i);
    expect(caveat).toHaveTextContent(/refunds are not deducted/i);
  });

  it('renders the KPI band with the discount tile carrying its own reserve', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-revenue', 'kpi-items-sold', 'kpi-products',
      'kpi-avg-item', 'kpi-discounts', 'kpi-top-product',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-top-product')).toHaveTextContent('Croissant');
    expect(within(band).getByTestId('kpi-discounts')).toHaveTextContent(/not attributable/i);
  });

  it('splits revenue by channel — the assumed gap with the POS Top products report', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    const card = screen.getByTestId('breakdown-channels');
    // Chaque canal se lit DEUX fois dans la carte : sa piste, puis la légende de
    // la barre de partage — c'est la seconde lecture des mêmes lignes voulue par
    // l'archétype, pas un doublon.
    expect(within(card).getAllByText('Counter')).toHaveLength(2);
    expect(within(card).getAllByText('B2B')).toHaveLength(2);
    expect(within(card).getByTestId('breakdown-sharebar')).toBeInTheDocument();
  });

  it('opens the sales lines of the clicked product, and its footer totals the FULL set', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    fireEvent.click(screen.getByTestId('open-lines-p2'));

    const drawer = await screen.findByTestId('product-sales-lines-drawer');
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_product_sales_lines_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_product_id: string }])[1];
      expect(args.p_product_id).toBe('p2');
    });

    // Heure de vente, n° de commande lié par order_id, client, quantité, remise.
    const table = await within(drawer).findByTestId('lines-table');
    const link = within(table).getByRole('link', { name: /#0004/ });
    expect(link).toHaveAttribute('href', '/backoffice/orders/o9');
    expect(within(table).getByRole('link', { name: 'Warung Sari' }))
      .toHaveAttribute('href', '/backoffice/customers/cu1');
    expect(within(table).getByText('Walk-in')).toBeInTheDocument();
    expect(table).toHaveTextContent(/30 Jun 2026, 09:15/);

    // Deux lignes descendues, cinq au total : le pied dit le total.
    expect(within(drawer).getByTestId('lines-count')).toHaveTextContent('2 of 5 lines');
  });

  it('shows the sold-as name when it differs from the current product name', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    fireEvent.click(screen.getByTestId('open-lines-p2'));
    const drawer = await screen.findByTestId('product-sales-lines-drawer');
    expect(await within(drawer).findByText(/sold as .Croissant classique./))
      .toBeInTheDocument();
  });

  it('offers the CSV export, and no PDF (no template registered)', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('renders the empty state when nothing was sold', async () => {
    salesPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No product was sold in the selected date range/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('sbp-product-detail')).toBeNull();
  });
});
