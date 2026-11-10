// apps/backoffice/src/pages/reports/__tests__/production-vs-sales-page.smoke.test.tsx
//
// S3-19 — « Production vs Sales » : ce que la page promet.
//
//  · les KPI viennent de `summary`, quantités seules, vendu détaillé comptoir/B2B ;
//  · les filtres Category et Item sont LUS DE L'URL et partent dans
//    `p_category_id` / `p_product_id` ; la liste Item ne se vide pas quand un
//    article est choisi (elle vient du résultat sans filtre article) ;
//  · trois vues persistées dans l'URL, tri par colonne, pied = `summary` ;
//  · l'écart négatif se dit par le signe et un libellé, pas par la couleur seule ;
//  · le tiroir d'article lit ses jours dans `by_day_product`, SANS nouvel appel ;
//  · export CSV de la vue affichée, état vide, refus propriétaire, période rognée.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const downloadCsv = vi.hoisted(() => vi.fn());
const buildCsv = vi.hoisted(() => vi.fn((_rows: unknown[], _columns: { header: string }[]) => 'csv'));
vi.mock('@breakery/domain', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  downloadCsv,
  buildCsv,
}));

const ZERO = { produced: 0, sold_counter: 0, sold_b2b: 0, sold_total: 0, wasted: 0, gap: 0 };

const CATEGORIES = [
  { id: 'c1', name: 'Classic breads', slug: 'classic-breads' },
  { id: 'c2', name: 'Classic viennoiserie', slug: 'classic-viennoiserie' },
];

const P1 = { product_id: 'p1', product_name: 'Baguette', category_id: 'c1', category_name: 'Classic breads',
  produced: 40, sold_counter: 30, sold_b2b: 3, sold_total: 33, wasted: 2, gap: 5, sell_through_pct: 82.5 };
const P3 = { product_id: 'p3', product_name: 'Sourdough', category_id: 'c1', category_name: 'Classic breads',
  produced: 10, sold_counter: 8, sold_b2b: 0, sold_total: 8, wasted: 0, gap: 2, sell_through_pct: 80 };
const P2 = { product_id: 'p2', product_name: 'Croissant', category_id: 'c2', category_name: 'Classic viennoiserie',
  produced: 20, sold_counter: 20, sold_b2b: 4, sold_total: 24, wasted: 0, gap: -4, sell_through_pct: 120 };

const FULL = {
  period: { start: '2026-11-01', end: '2026-11-02' },
  timezone: 'Asia/Makassar',
  generated_at: '2026-11-10T08:00:00+08:00',
  categories: CATEGORIES,
  summary: { produced: 70, sold_counter: 58, sold_b2b: 7, sold_total: 65, wasted: 2, gap: 3, sell_through_pct: 92.9 },
  by_day: [
    { date: '2026-11-01', produced: 40, sold_counter: 30, sold_b2b: 3, sold_total: 33, wasted: 2, gap: 5 },
    { date: '2026-11-02', produced: 30, sold_counter: 28, sold_b2b: 4, sold_total: 32, wasted: 0, gap: -2 },
  ],
  by_category: [
    { category_id: 'c1', category_name: 'Classic breads', produced: 50, sold_counter: 38, sold_b2b: 3,
      sold_total: 41, wasted: 2, gap: 7, sell_through_pct: 82 },
    { category_id: 'c2', category_name: 'Classic viennoiserie', produced: 20, sold_counter: 20, sold_b2b: 4,
      sold_total: 24, wasted: 0, gap: -4, sell_through_pct: 120 },
  ],
  // Servi trié par écart décroissant, comme la RPC.
  by_product: [P1, P3, P2],
  by_day_product: [
    { date: '2026-11-02', product_id: 'p2', produced: 10, sold_counter: 12, sold_b2b: 2, sold_total: 14, wasted: 0, gap: -4 },
    { date: '2026-11-01', product_id: 'p2', produced: 10, sold_counter: 8, sold_b2b: 2, sold_total: 10, wasted: 0, gap: 0 },
    { date: '2026-11-01', product_id: 'p1', produced: 40, sold_counter: 30, sold_b2b: 3, sold_total: 33, wasted: 2, gap: 5 },
  ],
};

const ONLY_CROISSANT = {
  ...FULL,
  summary: { ...P2, product_id: undefined },
  by_category: [FULL.by_category[1]],
  by_product: [P2],
  by_day_product: FULL.by_day_product.filter((d) => d.product_id === 'p2'),
};

const EMPTY = {
  ...FULL,
  summary: { ...ZERO, sell_through_pct: null },
  by_day: FULL.by_day.map((d) => ({ ...d, ...ZERO })),
  by_category: [], by_product: [], by_day_product: [],
};

let payload: unknown = FULL;
let rpcError: { code: string; message: string } | null = null;
const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn !== 'get_production_vs_sales_v1') return Promise.resolve({ data: null, error: null });
      if (rpcError !== null) return Promise.resolve({ data: null, error: rpcError });
      if (args.p_product_id === 'p2') return Promise.resolve({ data: ONLY_CROISSANT, error: null });
      return Promise.resolve({ data: payload, error: null });
    },
  },
}));

import ProductionVsSalesPage from '@/pages/reports/ProductionVsSalesPage.js';
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

function renderPage(search = '?start=2026-11-01&end=2026-11-02') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/production-vs-sales${search}`]}>
        <ProductionVsSalesPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rpcCalls(): Record<string, unknown>[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_production_vs_sales_v1')
    .map(([, args]) => args as Record<string, unknown>);
}

function bodyRows(testId: string): HTMLElement[] {
  const table = within(screen.getByTestId(testId)).getByRole('table');
  return Array.from(table.querySelectorAll<HTMLElement>('tbody tr'));
}

/** Le nom d'article vit aussi dans la liste Item : on attend le bouton de ligne. */
async function loaded(): Promise<void> {
  await screen.findByTestId('open-item-p1');
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  downloadCsv.mockClear();
  buildCsv.mockClear();
  sessionStorage.clear();
  payload = FULL;
  rpcError = null;
});

describe('ProductionVsSalesPage', () => {
  it('renders the title and the KPI band from summary, quantities only', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Production vs Sales', level: 1 })).toBeInTheDocument();
    const produced = await screen.findByTestId('kpi-produced');
    await waitFor(() => { expect(produced).toHaveTextContent('70'); });
    expect(screen.getByTestId('kpi-sold')).toHaveTextContent('65');
    expect(screen.getByTestId('kpi-sold')).toHaveTextContent('Counter 58 · B2B 7');
    expect(screen.getByTestId('kpi-waste')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-gap')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-sell-through')).toHaveTextContent('92,9%');
    expect(screen.getByTestId('report-kpi-band')).not.toHaveTextContent(/Rp/);
  });

  it('reads Category and Item from the URL and sends them to the RPC', async () => {
    renderPage('?start=2026-11-01&end=2026-11-02&category_id=c2&product_id=p2');
    await waitFor(() => {
      expect(rpcCalls()).toContainEqual({
        p_start_date: '2026-11-01', p_end_date: '2026-11-02', p_category_id: 'c2', p_product_id: 'p2',
      });
    });
    // La liste Item vient du résultat SANS filtre article : elle ne se vide pas.
    expect(rpcCalls()).toContainEqual({
      p_start_date: '2026-11-01', p_end_date: '2026-11-02', p_category_id: 'c2',
    });
    const item = screen.getByTestId('filter-product_id');
    await waitFor(() => { expect(within(item).getByRole('option', { name: 'Baguette' })).toBeInTheDocument(); });
    expect(item).toHaveValue('p2');
    await waitFor(() => { expect(bodyRows('pvs-table-item')).toHaveLength(1); });
  });

  it('applies the Category filter from the select and from a category click', async () => {
    renderPage();
    await loaded();
    fireEvent.change(screen.getByTestId('filter-category_id'), { target: { value: 'c1' } });
    expect(screen.getByTestId('location').textContent).toContain('category_id=c1');
    await waitFor(() => { expect(rpcCalls().some((a) => a.p_category_id === 'c1')).toBe(true); });

    fireEvent.change(screen.getByTestId('filter-category_id'), { target: { value: '' } });
    fireEvent.mouseDown(screen.getByTestId('view-category'));
    fireEvent.click(await screen.findByTestId('filter-category-c2'));
    expect(screen.getByTestId('location').textContent).toContain('category_id=c2');
  });

  it('switches between the three views and keeps the view in the URL', async () => {
    renderPage();
    await loaded();
    expect(screen.getByTestId('pvs-table-item')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('view-category'));
    expect(await screen.findByTestId('pvs-table-category')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toContain('view=category');
    expect(bodyRows('pvs-table-category')).toHaveLength(2);

    fireEvent.mouseDown(screen.getByTestId('view-day'));
    expect(await screen.findByTestId('pvs-table-day')).toBeInTheDocument();
    expect(bodyRows('pvs-table-day')[0]).toHaveTextContent(/1 November 2026/);
  });

  it('keeps the server order (gap desc), sorts on demand, and totals from summary', async () => {
    renderPage();
    await loaded();
    let rows = bodyRows('pvs-table-item').slice(0, 3);
    expect(rows.map((r) => r.querySelector('button')?.textContent)).toEqual(['Baguette', 'Sourdough', 'Croissant']);

    fireEvent.click(screen.getByTestId('sort-name'));
    rows = bodyRows('pvs-table-item').slice(0, 3);
    expect(rows[0]).toHaveTextContent('Baguette');
    expect(rows[1]).toHaveTextContent('Croissant');

    const footer = screen.getByTestId('pvs-table-item-footer');
    expect(footer).toHaveTextContent('Total');
    expect(footer).toHaveTextContent('70');
    expect(footer).toHaveTextContent('92,9%');
  });

  it('renders a negative gap with its sign and an accessible label', async () => {
    renderPage();
    await loaded();
    const croissant = bodyRows('pvs-table-item').find((r) => r.textContent?.includes('Croissant'));
    if (croissant === undefined) throw new Error('Croissant row not rendered');
    const gap = within(croissant).getByTestId('gap-negative');
    expect(gap).toHaveTextContent('−4');
    expect(gap).toHaveTextContent('sold beyond output');
  });

  it('opens the item drawer with its days, totals and links, without a new call', async () => {
    renderPage();
    await loaded();
    const before = rpcCalls().length;
    fireEvent.click(screen.getByTestId('open-item-p2'));

    const drawer = await screen.findByTestId('pvs-item-drawer');
    const days = within(drawer).getByTestId('pvs-item-days');
    const dayRows = within(days).getAllByRole('row').slice(1, -1);
    // Triés par date croissante.
    expect(dayRows[0]).toHaveTextContent(/1 November 2026/);
    expect(dayRows[1]).toHaveTextContent(/2 November 2026/);
    expect(within(drawer).getByTestId('pvs-item-total')).toHaveTextContent('24');
    expect(within(drawer).getByRole('link', { name: /Open product/ }))
      .toHaveAttribute('href', '/backoffice/products/p2');
    expect(within(drawer).getByTestId('pvs-sales-link'))
      .toHaveAttribute('href', '/backoffice/reports/sales-by-product?start=2026-11-01&end=2026-11-02');
    expect(rpcCalls().length).toBe(before);
  });

  it('exports the displayed view as CSV', async () => {
    renderPage('?start=2026-11-01&end=2026-11-02&view=category');
    await screen.findByTestId('pvs-table-category');
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(downloadCsv).toHaveBeenCalledWith('csv', 'production-vs-sales-categories-2026-11-01_2026-11-02');
    const [rows, columns] = buildCsv.mock.calls[0] ?? [[], []];
    expect(rows).toHaveLength(2);
    expect(columns.map((c) => c.header)).toEqual([
      'Category', 'Produced', 'Sold counter', 'Sold B2B', 'Sold total', 'Approved waste', 'Gap', 'Sell-through %',
    ]);
  });

  it('exports only the rows the table shows, in the displayed order', async () => {
    renderPage();
    await loaded();
    fireEvent.change(screen.getByTestId('pvs-table-item-search'), { target: { value: 'o' } });
    // « o » garde Sourdough et Croissant, pas Baguette ; tri par nom ensuite.
    await waitFor(() => { expect(bodyRows('pvs-table-item')).toHaveLength(2); });
    fireEvent.click(screen.getByTestId('sort-name'));
    fireEvent.click(screen.getByTestId('export-menu'));
    fireEvent.click(screen.getByTestId('export-csv'));
    const [rows] = buildCsv.mock.calls[0] ?? [[], []];
    const names = rows.map((r) => (typeof r === 'object' && r !== null && 'product_name' in r ? r.product_name : null));
    expect(names).toEqual(['Croissant', 'Sourdough']);
  });

  it('shows the empty state when nothing was produced or sold', async () => {
    payload = EMPTY;
    renderPage();
    expect(await screen.findByText('Nothing produced or sold')).toBeInTheDocument();
  });

  it('explains the owner-only refusal (P0003) in the shell banner', async () => {
    rpcError = { code: 'P0003', message: 'stock_visibility_owner_required' };
    renderPage();
    expect(await screen.findByTestId('report-error')).toHaveTextContent(/available to the owner/);
  });

  it('says when the served period is shorter than the requested one', async () => {
    renderPage('?start=2026-07-01&end=2026-11-02');
    const note = await screen.findByTestId('period-clipped');
    expect(note).toHaveTextContent(/at most 92 days/);
    expect(note).toHaveTextContent(/1 Nov – 2 Nov/);
  });

  it('carries the reading notes', async () => {
    renderPage();
    await loaded();
    const notes = screen.getByTestId('pvs-reading-notes');
    expect(notes).toHaveTextContent('Informational report: it does not change stock.');
    expect(notes).toHaveTextContent(/combo/);
    expect(notes).toHaveTextContent(/gifts/);
    expect(notes).toHaveTextContent(/approved waste/i);
    expect(notes).toHaveTextContent(/not a stock level/);
    expect(notes).toHaveTextContent(/cancelled after preparation .*stay in the gap/);
    expect(notes).toHaveTextContent(/Only fresh daily items are covered/);
  });
});
