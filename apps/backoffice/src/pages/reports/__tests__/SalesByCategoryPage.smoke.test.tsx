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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
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

const START = '2026-06-01';
const END   = '2026-06-07';

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-category${search}`]}>
        <SalesByCategoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function boundsQueried(): { p_date_start: string; p_date_end: string }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_sales_by_category_v3')
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
