// apps/backoffice/src/pages/reports/__tests__/basket-analysis-drilldown.smoke.test.tsx
//
// S31 — les deux cellules d'une paire ouvrent chacune leur fiche produit.
//
// Lot D (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 SANS graphe : une paire produit n'a ni axe temporel ni base commune, la
// tracer donnerait une figure décorative. Ce fichier tient donc aussi
// l'ABSENCE de figure, le contrôle « Top N » de la barre d'actions et l'export
// sous menu.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseBasketAnalysis = vi.fn();

vi.mock('@/features/reports/hooks/useBasketAnalysis.js', () => ({
  BASKET_ANALYSIS_QK: ['reports', 'basket-analysis'],
  useBasketAnalysis: (...a: unknown[]): unknown => mockUseBasketAnalysis(...a),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: vi.fn() } }));

import BasketAnalysisPage from '../BasketAnalysisPage.js';
import { useAuthStore } from '@/stores/authStore.js';

const PAIRS = [
  {
    product_id_a: 'p-1', product_a_name: 'Croissant',
    product_id_b: 'p-2', product_b_name: 'Café',
    co_occurrence_count: 12,
    support_a: 0.3, support_b: 0.4, support_pair: 0.1,
    confidence: 0.5, lift: 1.25,
  },
];

function ok<T>(data: T) {
  return { data, isLoading: false, error: null };
}

function seed(state: unknown = ok(PAIRS)) {
  mockUseBasketAnalysis.mockReturnValue(state);
}

function renderPage(search = '?start=2026-06-01&end=2026-06-07') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/basket-analysis${search}`]}>
        <BasketAnalysisPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
  seed();
});

describe('BasketAnalysisPage — archétype Report + drill-down (S31)', () => {
  it('both pair cells render a link with the correct product href', () => {
    renderPage();
    const table = screen.getByTestId('basket-pairs-table');
    expect(within(table).getByRole('link', { name: /Croissant/ }).getAttribute('href'))
      .toBe('/backoffice/products/p-1');
    expect(within(table).getByRole('link', { name: /Café/ }).getAttribute('href'))
      .toBe('/backoffice/products/p-2');
  });

  it('AUCUN graphe : la table de paires est la figure', () => {
    renderPage();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByTestId('basket-pairs-table')).toBeInTheDocument();
  });

  it('lift et confiance en locale métier, jamais en point décimal anglais', () => {
    renderPage();
    const table = screen.getByTestId('basket-pairs-table');
    expect(within(table).getByText('1,25×')).toBeInTheDocument();
    expect(within(table).getByText('50,0%')).toBeInTheDocument();
    expect(within(table).queryByText('1.25')).toBeNull();
  });

  it('toolbar : Top N, période, export sous menu (CSV + PDF), pas de Print', () => {
    renderPage();
    expect(screen.getByLabelText('Top N')).toHaveValue(10);
    expect(screen.getByTestId('period-control')).toBeInTheDocument();
    expect(screen.queryByTestId('print-report')).toBeNull();
    // Pas de bouton « Compare » : la RPC ne rend qu'une fenêtre.
    expect(screen.queryByTestId('compare-toggle')).toBeNull();

    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.getByTestId('export-pdf')).toBeInTheDocument();
  });

  it('période sans paire : EmptyState, pas de table', () => {
    seed(ok([]));
    renderPage();
    expect(screen.getByText('No paired sales')).toBeInTheDocument();
    expect(screen.queryByTestId('basket-pairs-table')).toBeNull();
  });

  it('erreur RPC : bannière role=alert unifiée', () => {
    seed({ data: undefined, isLoading: false, error: new Error('boom') });
    renderPage();
    expect(screen.getByTestId('report-error')).toHaveTextContent('boom');
    expect(screen.queryByTestId('basket-pairs-table')).toBeNull();
  });

  it('chargement : squelettes de la bande, aucun chiffre affirmé', () => {
    seed({ data: undefined, isLoading: true, error: null });
    renderPage();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
    expect(screen.queryByTestId('kpi-top-lift')).toBeNull();
  });
});
