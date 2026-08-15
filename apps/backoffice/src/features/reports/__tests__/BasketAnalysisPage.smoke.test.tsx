// apps/backoffice/src/features/reports/__tests__/BasketAnalysisPage.smoke.test.tsx
// Phase 6.A smoke for Basket Analysis.
//
// Lot D (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Deux propriétés ajoutées ici :
//
//  · les bornes de la période unifiée partent bien en RPC, avec le plafond
//    `top_n` toujours porté par l'URL ;
//  · le LAVIS DORÉ des trois premières lignes a disparu : `i < 3 && lift > 1`
//    était un signal de couleur sans légende, donc un code privé, sur un seuil
//    arbitraire. La paire de tête est nommée dans la bande KPI, et la colonne
//    « Lift » porte sa définition sous la table.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BasketAnalysisPage from '@/pages/reports/BasketAnalysisPage.js';
import { useAuthStore } from '@/stores/authStore.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_basket_analysis_v3') {
        return Promise.resolve({
          data: [
            {
              product_id_a: '11111111-1111-1111-1111-111111111111',
              product_a_name: 'Croissant',
              product_id_b: '22222222-2222-2222-2222-222222222222',
              product_b_name: 'Latte',
              co_occurrence_count: 12,
              support_a: 0.18,
              support_b: 0.22,
              support_pair: 0.10,
              confidence: 0.55,
              lift: 2.5,
            },
            {
              product_id_a: '33333333-3333-3333-3333-333333333333',
              product_a_name: 'Bagel',
              product_id_b: '44444444-4444-4444-4444-444444444444',
              product_b_name: 'Espresso',
              co_occurrence_count: 5,
              support_a: 0.08,
              support_b: 0.12,
              support_pair: 0.04,
              confidence: 0.33,
              lift: 1.3,
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

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

describe('BasketAnalysisPage (smoke)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    sessionStorage.clear();
    useAuthStore.setState({ permissions: ['reports.export'] });
  });

  it('renders heading and top cross-sells from RPC payload', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Basket Analysis', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Latte')).toBeInTheDocument();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_basket_analysis_v3');
      expect(call).toBeDefined();
      const args = (call as [string, { p_date_start: string; p_date_end: string; p_top_n: number }])[1];
      expect(args.p_date_start).toBe('2026-06-01');
      expect(args.p_date_end).toBe('2026-06-07');
      expect(args.p_top_n).toBe(10);
    });
  });

  it('le plafond `top_n` reste porté par l’URL', async () => {
    renderPage('?start=2026-06-01&end=2026-06-07&top_n=25');
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_basket_analysis_v3');
      expect((call as [string, { p_top_n: number }])[1].p_top_n).toBe(25);
    });
  });

  it('bande KPI : la paire de tête est NOMMÉE, aucune variation vide', async () => {
    renderPage();
    await screen.findByTestId('kpi-top-lift');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-top-lift', 'kpi-pairs', 'kpi-co-occurrences', 'kpi-best-confidence']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    const top = screen.getByTestId('kpi-top-lift');
    expect(within(top).getByText('2,50×')).toBeInTheDocument();
    expect(within(top).getByText('Croissant + Latte')).toBeInTheDocument();
    // Aucune comparaison possible sur cette RPC : des notes, pas des tirets de
    // delta qui promettraient une variation absente.
    expect(within(band).queryByText(/versus/)).toBeNull();
  });

  it('plus aucun lavis doré non légendé ; la définition du lift est sous la table', async () => {
    const { container } = renderPage();
    await screen.findByText('Croissant');
    expect(container.querySelector('.bg-gold-soft')).toBeNull();
    expect(screen.getByText(/more often than chance/)).toBeInTheDocument();
  });
});
