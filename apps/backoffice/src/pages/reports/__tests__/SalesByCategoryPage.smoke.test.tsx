// apps/backoffice/src/pages/reports/__tests__/SalesByCategoryPage.smoke.test.tsx
//
// Audit Reports 2026-08-01, lot E — SalesByCategoryPage etait la SEULE page du
// module sans aucun test.
//
// Lot D (campagne Reports 2026-08-15) — la page est réécrite sur le socle
// Report shell v2. Ce que ce fichier tient désormais, au-delà du « ça rend » :
//
//  · les bornes partent bien en RPC, ET la période de COMPARAISON aussi — sans
//    la seconde requête, la promesse « chaque chiffre porte sa comparaison »
//    serait décorative ;
//  · la carte de ventilation totalise le jeu COMPLET et referme ses 100 % ;
//  · l'export vit sous un MENU, et sans `reports.export` il se désactive en
//    disant pourquoi au lieu de disparaître.
//
// S3-22 (2026-11-11) — LES FILTRES DE COMMANDE (type, paiement, table) : chacun
// s'écrit dans l'URL, se relit depuis une URL initiale, et part dans
// `p_filters` du classement ET de sa comparaison ; sans filtre l'argument est
// omis ; le lien « View products » transporte les mêmes clés.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mockRpc = vi.fn();
let rows: unknown[] = [];
let injectRpcError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_category_v7') {
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

const START = '2026-06-01';
const END   = '2026-06-07';

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.search}</span>;
}

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-category${search}`]}>
        <SalesByCategoryPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function boundsQueried(): { p_date_start: string; p_date_end: string }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_sales_by_category_v7')
    .map(([, args]) => args as { p_date_start: string; p_date_end: string });
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockClear();
  sessionStorage.clear();
  rows = CATEGORY_ROWS;
  injectRpcError = false;
});

describe('SalesByCategoryPage (smoke)', () => {
  it('renders the page heading and the Reports › Sales breadcrumb', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Sales by Category/i, level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Reports');
    expect(nav).toHaveTextContent('Sales');
  });

  it('interroge la fenêtre ET la période précédente', async () => {
    renderPage();
    await waitFor(() => {
      expect(boundsQueried().length).toBeGreaterThanOrEqual(2);
    });
    const bounds = boundsQueried();
    expect(bounds).toContainEqual({ p_date_start: START, p_date_end: END });
    // `previousPeriod('2026-06-01','2026-06-07')` → la semaine d'avant.
    expect(bounds).toContainEqual({ p_date_start: '2026-05-25', p_date_end: '2026-05-31' });
    for (const b of bounds) {
      expect(b.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('renders one row per category once data loads', async () => {
    renderPage();
    expect((await screen.findAllByText('Viennoiserie')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Boissons').length).toBeGreaterThanOrEqual(1);
  });

  it('S3-22 — chaque catégorie ouvre Sales by Product filtré, même période, et garde la fiche', async () => {
    renderPage();
    const table = await screen.findByTestId('sbc-category-detail');
    const link = await within(table).findByRole('link', { name: /View products sold in Viennoiserie/ });
    expect(link).toHaveAttribute(
      'href',
      `/backoffice/reports/sales-by-product?category_id=c-1&start=${START}&end=${END}`,
    );
    // L'accès existant à la fiche catégorie reste en place.
    expect(within(table).getByRole('link', { name: 'Viennoiserie' })).toHaveAttribute(
      'href',
      `/backoffice/products?category_id=c-1&date_from=${START}&date_to=${END}`,
    );
  });

  it('formats revenue with the module IDR formatter, not a raw number', async () => {
    renderPage();
    // Audit lot D / R-15 — la table rendait `2400000` via `toLocaleString()`.
    // id-ID insere une insecable apres « Rp », que Testing Library normalise.
    expect(await screen.findByText('Rp 2.400.000')).toBeInTheDocument();
    expect(screen.getByText('Rp 600.000')).toBeInTheDocument();
    expect(screen.queryByText('2400000')).not.toBeInTheDocument();
  });

  it('bande KPI : revenu en héro, part de la catégorie de tête, une comparaison par chiffre', async () => {
    renderPage();
    await screen.findByTestId('kpi-revenue');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-revenue', 'kpi-items-sold', 'kpi-avg-item', 'kpi-categories', 'kpi-top-category']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // Un NOM ne varie pas : la tuile de tête porte une part, pas un delta.
    const top = within(band).getByTestId('kpi-top-category');
    expect(within(top).getByText('Viennoiserie')).toBeInTheDocument();
    expect(within(top).getByText('80,0% of revenue')).toBeInTheDocument();
    expect(within(top).queryByText(/versus prev/)).toBeNull();
    expect(within(band).getAllByText(/versus prev/)).toHaveLength(4);
  });

  it('un seul graphe, et une ventilation qui referme ses 100 %', async () => {
    renderPage();
    expect(await screen.findByRole('img', { name: /Revenue per product category/ })).toBeInTheDocument();
    expect(screen.getByTestId('chart-revenue-by-category')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Revenue per product category/ })).toHaveLength(1);

    const card = screen.getByTestId('breakdown-categories');
    expect(within(card).getByRole('img', { name: 'Share of revenue by category' })).toBeInTheDocument();
    // Deux catégories seulement : aucun reliquat « Others » à inventer.
    expect(within(card).queryByText('Others')).toBeNull();
    expect(within(card).getByTitle('Rp 3.000.000')).toBeInTheDocument();
  });

  it('carte top-5 : le total porte le jeu COMPLET et le reliquat est agrégé', async () => {
    rows = Array.from({ length: 8 }, (_, i) => ({
      category_id: `c${i}`, category_name: `Cat ${i}`, total: 1_000_000, qty: 10,
    }));
    renderPage();
    await screen.findByText('Top 5 of 8 by revenue.');
    const card = screen.getByTestId('breakdown-categories');
    expect(within(card).getByText('Top 5 of 8 by revenue.')).toBeInTheDocument();
    expect(within(card).getByTitle('Rp 8.000.000')).toBeInTheDocument();
    const others = within(card).getByText('Others');
    expect(others.closest('li')).toHaveTextContent('38%');
  });

  it('exposes CSV and PDF exports under the export menu', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  it('sans la permission reports.export : bouton désactivé et motif nommé', async () => {
    useAuthStore.setState({ permissions: [] });
    renderPage();
    const btn = await screen.findByTestId('export-menu');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the reports.export permission.');
  });

  it('shows the canonical empty state when there are no sales', async () => {
    rows = [];
    renderPage();
    expect(await screen.findByText('No sales')).toBeInTheDocument();
    expect(screen.queryByTestId('sbc-category-detail')).toBeNull();
  });

  it('surfaces a role="alert" element when the RPC fails', async () => {
    injectRpcError = true;
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByTestId('report-error').textContent).toMatch(/RPC error/i);
    expect(screen.queryByTestId('sbc-category-detail')).toBeNull();
  });
});

function callsOf(): Record<string, unknown>[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_sales_by_category_v7')
    .map(([, args]) => args as Record<string, unknown>);
}

/** Dernier `p_filters` envoyé, pour la période courante ET la comparaison. */
async function expectBothPeriodsFiltered(expected: Record<string, string>): Promise<void> {
  await waitFor(() => {
    const filtered = callsOf().filter((a) => {
      const f = a.p_filters as Record<string, string> | undefined;
      return f !== undefined && Object.entries(expected).every(([k, v]) => f[k] === v);
    });
    expect(filtered.some((a) => a.p_date_start === START)).toBe(true);
    expect(filtered.some((a) => a.p_date_start === '2026-05-25')).toBe(true);
  });
}

const FILTERED = `?start=${START}&end=${END}`
  + '&order_type=dine_in&payment_method=cash&table_number=T-07';

describe('SalesByCategoryPage — S3-22 filters', () => {
  it('sends no p_filters when no filter is active', async () => {
    renderPage();
    await screen.findAllByText('Viennoiserie');
    expect(callsOf().length).toBeGreaterThanOrEqual(2);
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('reads the three filters back from the initial URL and sends them to both periods', async () => {
    renderPage(FILTERED);
    const expected = { order_type: 'dine_in', payment_method: 'cash', table_number: 'T-07' };
    await waitFor(() => {
      const calls = callsOf();
      expect(calls.some((a) => a.p_date_start === START)).toBe(true);
      expect(calls.some((a) => a.p_date_start === '2026-05-25')).toBe(true);
      for (const a of calls) expect(a.p_filters).toEqual(expected);
    });
    expect(screen.getByTestId('filter-order_type')).toHaveValue('dine_in');
    expect(screen.getByTestId('filter-payment_method')).toHaveValue('cash');
    expect(screen.getByTestId('filter-table_number')).toHaveValue('T-07');
    // Ligne méta ET annonce live de ReportShell : au moins une occurrence.
    expect(screen.getAllByText(/3 filters active/).length).toBeGreaterThanOrEqual(1);
  });

  it('ignores an order type that is not a Postgres enum value', async () => {
    renderPage(`?start=${START}&end=${END}&order_type=take_away`);
    await screen.findAllByText('Viennoiserie');
    for (const a of callsOf()) expect(a).not.toHaveProperty('p_filters');
  });

  it('picking an order type writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Viennoiserie');
    fireEvent.change(screen.getByTestId('filter-order_type'), { target: { value: 'take_out' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('order_type=take_out');
    });
    await expectBothPeriodsFiltered({ order_type: 'take_out' });
  });

  it('picking a payment method writes it to the URL, to p_filters, and states its caveat', async () => {
    renderPage();
    await screen.findAllByText('Viennoiserie');
    expect(screen.queryByTestId('payment-filter-note')).toBeNull();
    fireEvent.change(screen.getByTestId('filter-payment_method'), { target: { value: 'qris' } });
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('payment_method=qris');
    });
    await expectBothPeriodsFiltered({ payment_method: 'qris' });
    expect(await screen.findByTestId('payment-filter-note')).toHaveTextContent(/counts in full under each/i);
  });

  it('typing a table number writes it to the URL and to p_filters', async () => {
    renderPage();
    await screen.findAllByText('Viennoiserie');
    const input = screen.getByTestId('filter-table_number');
    fireEvent.change(input, { target: { value: 'T-12' } });
    // Le champ commet au blur sans attendre le délai de frappe.
    fireEvent.blur(input);
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('table_number=T-12');
    });
    await expectBothPeriodsFiltered({ table_number: 'T-12' });
  });

  it('the View products link carries the same order filters as the page', async () => {
    renderPage(FILTERED);
    const table = await screen.findByTestId('sbc-category-detail');
    const link = await within(table).findByRole('link', { name: /View products sold in Viennoiserie/ });
    expect(link).toHaveAttribute(
      'href',
      `/backoffice/reports/sales-by-product?category_id=c-1&start=${START}&end=${END}`
        + '&order_type=dine_in&payment_method=cash&table_number=T-07',
    );
    // La fiche catégorie du catalogue n'a pas de filtres de commande.
    expect(within(table).getByRole('link', { name: 'Viennoiserie' })).toHaveAttribute(
      'href',
      `/backoffice/products?category_id=c-1&date_from=${START}&date_to=${END}`,
    );
  });

  it('Clear filters removes every filter from the URL at once and keeps the period', async () => {
    renderPage(FILTERED);
    await screen.findAllByText('Viennoiserie');
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      const search = screen.getByTestId('location').textContent ?? '';
      for (const k of ['order_type', 'payment_method', 'table_number']) {
        expect(search).not.toContain(`${k}=`);
      }
      expect(search).toContain(`start=${START}`);
    });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('table sorts by name on demand and keeps the total footer', async () => {
    renderPage();
    await screen.findAllByText('Viennoiserie');
    const table = within(screen.getByTestId('sbc-category-detail')).getByRole('table');
    let rows = within(table).getAllByRole('row');
    // En-tête + deux catégories (CA décroissant) + pied.
    expect(rows).toHaveLength(4);
    expect(rows[1]?.textContent ?? '').toMatch(/Viennoiserie/);
    expect(screen.getByTestId('sbc-table-footer')).toHaveTextContent('Rp 3.000.000');
    fireEvent.click(within(table).getByRole('button', { name: /Category/ }));
    rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent ?? '').toMatch(/Boissons/);
  });
});
