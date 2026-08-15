// apps/backoffice/src/pages/reports/__tests__/production-efficiency-page.smoke.test.tsx
//
// S40 Wave B3, révisé au lot F (campagne Reports 2026-08-15) — la page passe sur
// le socle Report shell v2. Ce que le fichier tient en plus depuis :
//  · la moyenne de période est PONDÉRÉE PAR LES LOTS, pas une moyenne de
//    moyennes — c'est la seule façon de ne pas donner le même poids à un produit
//    lancé une fois qu'à un produit lancé huit fois ;
//  · le « Daily Trend » est devenu un graphe, et la table journalière reste
//    sous lui parce qu'elle porte le taux de perte, absent de la courbe ;
//  · l'export passe par le menu unique du bandeau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductionEfficiencyPage from '@/pages/reports/ProductionEfficiencyPage.js';
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

// Mutable flag read by the rpc mock to switch between happy path and error path.
let simulateError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (simulateError) {
        return Promise.resolve({ data: null, error: { message: 'RPC efficiency error' } });
      }
      if (fn === 'get_production_efficiency_v1') {
        return Promise.resolve({
          data: {
            period: { start: '2026-05-13', end: '2026-06-12' },
            by_product: [
              {
                product_id:             'p-1',
                product_name:           'Croissant',
                runs:                   8,
                avg_yield_variance_pct: -5.2,
                worst_variance_pct:     -15.0,
                waste_rate_pct:         3.1,
                has_variance_reasons:   true,
              },
              {
                product_id:             'p-2',
                product_name:           'Sourdough',
                runs:                   4,
                avg_yield_variance_pct: 2.1,
                worst_variance_pct:     null,
                waste_rate_pct:         null,
                has_variance_reasons:   false,
              },
            ],
            by_day: [
              { date: '2026-06-10', avg_yield_variance_pct: -3.0, waste_rate_pct: 2.5 },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ProductionEfficiencyPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

/** Attend la table CHARGÉE : une PanelCard existe dès le montage, son corps
 *  n'est alors qu'un squelette. */
async function loadedCard(testId: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(within(screen.getByTestId(testId)).getAllByRole('row').length).toBeGreaterThan(1);
  });
  return screen.getByTestId(testId);
}

describe('ProductionEfficiencyPage (smoke)', () => {
  beforeEach(() => { simulateError = false; });

  it('renders heading and product rows with their variance', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Production Efficiency/i, level: 1 })).toBeInTheDocument();
    const table = await loadedCard('efficiency-by-product');
    expect(within(table).getByText('Croissant')).toBeInTheDocument();
    expect(within(table).getByText('Sourdough')).toBeInTheDocument();
    // Une mesure absente est un tiret, jamais un zéro.
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  // La moyenne de période est pondérée par `runs` : (−5,2×8 + 2,1×4) / 12 =
  // −2,83 %. Une moyenne de moyennes donnerait −1,55 %, et dirait donc que la
  // production dérive deux fois moins qu'en réalité.
  it('weights the period average by runs, not by product', async () => {
    renderPage();
    const tile = await screen.findByTestId('kpi-avg-variance');
    expect(tile.textContent).toMatch(/-2\.8%/);
    expect(tile.textContent).toMatch(/weighted by 12 runs/);
  });

  it('charts the daily trend and keeps the daily table under it', async () => {
    renderPage();
    expect(await screen.findByTestId('chart-yield-trend')).toBeInTheDocument();
    // La table journalière porte le TAUX DE PERTE, que la courbe ne trace pas.
    const byDay = await loadedCard('efficiency-by-day');
    expect(within(byDay).getByText('2.5%')).toBeInTheDocument();
  });

  it('offers a CSV export, and no PDF — no template is registered for this report', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces an error message when the RPC fails', async () => {
    simulateError = true;
    renderPage();
    expect(await screen.findByTestId('report-error')).toHaveTextContent('RPC efficiency error');
  });
});
