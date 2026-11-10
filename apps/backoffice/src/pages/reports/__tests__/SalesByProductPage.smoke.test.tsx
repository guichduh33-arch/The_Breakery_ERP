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
//
// S3-22 — LES FILTRES DE COMMANDE (type, paiement, table) partent dans
// `p_filters` du classement, de sa comparaison ET du tiroir ; la recherche
// produit reste côté client ; la réserve du filtre paiement est affichée.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
    { id: 'l1', sold_at: '2026-06-30T09:15:00+08:00', created_at: '2026-06-30T08:50:00+08:00',
      paid_at: '2026-06-30T09:15:00+08:00', table_number: 'T-07', order_id: 'o9', order_number: '#0004',
      customer_id: null, customer_name: null, channel: 'counter', served_by_name: 'Mamat',
      name_snapshot: 'Croissant', quantity: 2, unit_price: 10_000, modifiers_total: 0,
      discount_amount: 5_000, discount_reason: 'Staff', line_total: 15_000 },
    { id: 'l2', sold_at: '2026-06-29T08:02:00+08:00', created_at: '2026-06-29T08:02:00+08:00',
      paid_at: null, table_number: null, order_id: 'o8', order_number: '#0011',
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
        if (fn === 'get_sales_by_product_v6') {
          return Promise.resolve({ data: salesPayload, error: null });
        }
        if (fn === 'get_product_sales_lines_v7') {
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

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.search}</span>;
}

function renderPage(search = '?start=2026-06-01&end=2026-06-30') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-product${search}`]}>
        <SalesByProductPage />
        <LocationProbe />
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

  it('calls get_sales_by_product_v6 with the business-day bounds', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_sales_by_product_v6');
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
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_product_sales_lines_v7');
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

function callsOf(fn: string): Record<string, unknown>[] {
  return mockRpc.mock.calls
    .filter(([name]) => name === fn)
    .map(([, args]) => args as Record<string, unknown>);
}

const FILTERED = '?start=2026-06-01&end=2026-06-30'
  + '&order_type=dine_in&payment_method=cash&table_number=T-07';

describe('SalesByProductPage — S3-22 filters', () => {
  it('sends the three order filters to the ranking AND its compare period', async () => {
    renderPage(FILTERED);
    const expected = { order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07' };
    await waitFor(() => {
      const calls = callsOf('get_sales_by_product_v6');
      // Période courante + période de comparaison : même portée.
      expect(calls.some((a) => a.p_start_date === '2026-06-01')).toBe(true);
      expect(calls.some((a) => a.p_start_date !== '2026-06-01')).toBe(true);
      for (const a of calls) expect(a.p_filters).toEqual(expected);
    });
    expect(screen.getByTestId('filter-order_type')).toHaveValue('dine_in');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('cash');
    expect(screen.getByTestId('filter-table_number')).toHaveValue('T-07');
  });

  it('passes the same filters to the sales lines drawer', async () => {
    renderPage(FILTERED);
    await screen.findAllByText('Croissant');
    fireEvent.click(screen.getByTestId('open-lines-p2'));
    await waitFor(() => {
      const call = callsOf('get_product_sales_lines_v7')[0];
      expect(call).toBeDefined();
      expect(call?.p_product_id).toBe('p2');
      expect(call?.p_filters).toEqual({
        order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07',
      });
    });
  });

  it('sends no p_filters when no filter is active', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    for (const a of callsOf('get_sales_by_product_v6')) expect(a).not.toHaveProperty('p_filters');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('ignores an order type that is not a Postgres enum value', async () => {
    renderPage('?start=2026-06-01&end=2026-06-30&order_type=take_away');
    await screen.findAllByText('Croissant');
    for (const a of callsOf('get_sales_by_product_v6')) expect(a).not.toHaveProperty('p_filters');
  });

  it('picking an order type writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    fireEvent.change(screen.getByTestId('filter-order_type'), { target: { value: 'take_out' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('order_type=take_out');
    });
    await waitFor(() => {
      expect(callsOf('get_sales_by_product_v6').some(
        (a) => (a.p_filters as { order_type?: string } | undefined)?.order_type === 'take_out',
      )).toBe(true);
    });
  });

  it('keeps the category filter on its category_id URL key', async () => {
    renderPage('?start=2026-06-01&end=2026-06-30&category_id=c1');
    await waitFor(() => {
      expect(callsOf('get_sales_by_product_v6').some((a) => a.p_category_id === 'c1')).toBe(true);
    });
    expect(await screen.findByRole('option', { name: 'Bread' })).toBeInTheDocument();
    expect(screen.getByTestId('filter-category_id')).toHaveValue('c1');
  });

  it('states the payment-filter caveat only while that filter is active', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    expect(screen.queryByTestId('payment-filter-note')).toBeNull();
    fireEvent.change(screen.getByTestId('filter-payment_method'), { target: { value: 'qris' } });
    const note = await screen.findByTestId('payment-filter-note');
    expect(note).toHaveTextContent(/counts in full under each/i);
    expect(note).toHaveTextContent(/Orders with no recorded payment line are left out/i);
    expect(note).not.toHaveTextContent(/B2B/);
  });

  it('Clear filters removes every filter AND the product search from the URL at once', async () => {
    renderPage(`${FILTERED}&category_id=c1&q=bague`);
    await screen.findAllByText('Baguette');
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      const search = screen.getByTestId('location').textContent ?? '';
      for (const k of ['order_type', 'payment_method', 'table_number', 'category_id', 'q']) {
        expect(search).not.toContain(`${k}=`);
      }
      expect(search).toContain('start=2026-06-01');
    });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
    // La table se redessine après le rechargement des filtres retirés.
    expect(await screen.findByTestId('sbp-table-search')).toHaveValue('');
  });

  it('shows Clear filters when only the product search is active, and it unrestricts the table', async () => {
    renderPage('?start=2026-06-01&end=2026-06-30&q=bague');
    await screen.findAllByText('Baguette');
    const table = within(screen.getByTestId('sbp-product-detail')).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      expect(screen.getByTestId('location')).not.toHaveTextContent('q=');
    });
    // En-tête + deux produits + pied du total revenu.
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('product search narrows the table without calling the server again', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    await waitFor(() => { expect(callsOf('get_sales_by_product_v6').length).toBeGreaterThan(0); });
    const before = mockRpc.mock.calls.length;

    fireEvent.change(screen.getByTestId('sbp-table-search'), { target: { value: 'bague' } });

    const table = within(screen.getByTestId('sbp-product-detail')).getByRole('table');
    const rows = within(table).getAllByRole('row');
    // En-tête + une seule ligne ; le pied du jeu complet se tait.
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent ?? '').toMatch(/Baguette/);
    expect(screen.getByTestId('sbp-table-count')).toHaveTextContent('1 of 2 products');
    expect(screen.getByTestId('location')).toHaveTextContent('q=bague');
    expect(mockRpc.mock.calls.length).toBe(before);
    // Les KPI restent ceux du rapport entier.
    expect(screen.getByTestId('kpi-top-product')).toHaveTextContent('Croissant');
  });
});
