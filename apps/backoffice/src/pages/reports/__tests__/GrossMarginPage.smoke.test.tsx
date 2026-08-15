// apps/backoffice/src/pages/reports/__tests__/GrossMarginPage.smoke.test.tsx
//
// S57 P2.6 — GrossMarginPage render smoke.
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Ce fichier tient ce qui ne doit pas se perdre dans une migration de
// présentation :
//
//  · LE CAVEAT WAC RESTE AFFICHÉ. Il conditionne la lecture de chaque chiffre
//    de l'écran : le COGS est au coût moyen COURANT, pas à un instantané de
//    vente ;
//  · le classement par marge décroissante ;
//  · le Pareto rapporte son cumul au jeu COMPLET, pas aux seules barres.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const CATEGORY_ROWS = [
  { id: 'c1', name: 'Bread', slug: 'bread', sort_order: 1, is_active: true,
    dispatch_station: '', kds_station: '', show_in_pos: true, category_type: 'finished' },
];

// Non-empty margin payload: two products, unsorted (croissant has higher margin).
const MARGIN_DATA = {
  period:  { start: '2026-06-01', end: '2026-06-30' },
  summary: { revenue: 3_000_000, cogs: 1_000_000, margin: 2_000_000, margin_pct: 66.7 },
  by_product: [
    { product_id: 'p1', name: 'Baguette',  category_name: 'Bread', qty: 100,
      revenue: 1_000_000, cogs: 600_000, margin: 400_000,   margin_pct: 40.0 },
    { product_id: 'p2', name: 'Croissant', category_name: 'Bread', qty: 200,
      revenue: 2_000_000, cogs: 400_000, margin: 1_600_000, margin_pct: 80.0 },
  ],
  by_category: [
    { category_id: 'c1', category_name: 'Bread', qty: 300,
      revenue: 3_000_000, cogs: 1_000_000, margin: 2_000_000, margin_pct: 66.7 },
  ],
};

const EMPTY_DATA = {
  period:  { start: '2026-06-01', end: '2026-06-30' },
  summary: { revenue: 0, cogs: 0, margin: 0, margin_pct: 0 },
  by_product:  [],
  by_category: [],
};

let marginPayload: unknown = MARGIN_DATA;
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
      rpc:  (fn: string, args: Record<string, unknown>) => {
        mockRpc(fn, args);
        if (fn === 'get_gross_margin_by_product_v1') {
          return Promise.resolve({ data: marginPayload, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

import GrossMarginPage from '@/pages/reports/GrossMarginPage.js';
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
      <MemoryRouter initialEntries={[`/backoffice/reports/gross-margin${search}`]}>
        <GrossMarginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — ce test verifie le CABLAGE de
// l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  marginPayload = MARGIN_DATA;
});

describe('GrossMarginPage smoke', () => {
  it('renders the page heading and the Reports › Financial breadcrumb', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Gross Margin/i, level: 1 }),
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Financial');
  });

  it('calls get_gross_margin_by_product_v1 with p_start_date and p_end_date', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_gross_margin_by_product_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start_date: string; p_end_date: string }])[1];
      expect(args.p_start_date).toBe('2026-06-01');
      expect(args.p_end_date).toBe('2026-06-30');
    });
  });

  it('renders product rows sorted by margin desc', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    const table = within(screen.getByTestId('gm-product-detail')).getByRole('table');
    const rows = within(table).getAllByRole('row');
    // rows[0] = thead ; rows[1] = highest margin (Croissant, 1.6M).
    expect(rows[1]?.textContent ?? '').toMatch(/Croissant/);
    expect(rows[2]?.textContent ?? '').toMatch(/Baguette/);
  });

  it('surfaces the WAC cost-basis caveat', async () => {
    renderPage();
    await screen.findAllByText('Croissant');
    expect(screen.getByTestId('wac-caveat')).toHaveTextContent(/weighted-average cost/i);
  });

  it('bande KPI : marge en hero, un seul graphe en Pareto', async () => {
    renderPage();
    await screen.findByTestId('kpi-margin');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-margin', 'kpi-revenue', 'kpi-cogs', 'kpi-margin-pct', 'kpi-products', 'kpi-top-product',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(band).getByTestId('kpi-top-product')).toHaveTextContent('Croissant');
    await screen.findByRole('img', { name: /Margin per product/ });
    expect(screen.getByTestId('chart-margin-pareto')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Margin per product/ })).toHaveLength(1);
  });

  it('shows the CSV export under the menu, and no PDF (no template registered)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  // Cas réel sur la base de dev : sur une fenêtre où le COGS dépasse le revenu,
  // la marge TOTALE est négative. Une part d'un total négatif n'existe pas —
  // `sharePct` rendrait 0 % sur chaque ligne et une barre vide se lirait
  // « aucune catégorie ne pèse ».
  it('marge totale NÉGATIVE : aucune part inventée, ni en piste ni en barre', async () => {
    marginPayload = {
      ...MARGIN_DATA,
      summary: { revenue: 1_600_000, cogs: 2_190_000, margin: -590_000, margin_pct: -36.9 },
      by_category: [
        { category_id: 'c1', category_name: 'Coffee', qty: 10,
          revenue: 200_000, cogs: 13_000, margin: 187_000, margin_pct: 93.5 },
        { category_id: 'c2', category_name: 'Flour', qty: 5,
          revenue: 100_000, cogs: 877_000, margin: -777_000, margin_pct: -777.0 },
      ],
    };
    renderPage();
    await screen.findByTestId('kpi-top-product');
    const card = screen.getByTestId('breakdown-margin-categories');
    expect(within(card).getByText(/Margin is negative over this period/)).toBeInTheDocument();
    expect(within(card).queryByRole('img', { name: /Share of margin/ })).toBeNull();
    expect(within(card).queryByText('0%')).toBeNull();
    // La tuile de tête bascule sur le TAUX du produit, qui reste vrai.
    expect(screen.getByTestId('kpi-top-product')).toHaveTextContent('80.0% margin rate');
  });

  it('renders the empty state when there are no sales', async () => {
    marginPayload = EMPTY_DATA;
    renderPage();
    expect(
      await screen.findByText(/No sales in the selected date range/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('gm-product-detail')).toBeNull();
  });
});
