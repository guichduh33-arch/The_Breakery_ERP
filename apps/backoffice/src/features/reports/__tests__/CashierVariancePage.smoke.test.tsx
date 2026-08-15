// apps/backoffice/src/features/reports/__tests__/CashierVariancePage.smoke.test.tsx
//
// S70 — rapport lecture seule de variance de caisse (fiche 12 D2.4).
//
// Lot D (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Trois propriétés que ce fichier tient et que l'ancienne version n'avait
// pas :
//
//  · `totals` (cash / QRIS / card), câblé au lot A1 et JETÉ par la page, porte
//    désormais la bande KPI — et une caisse NON COMPTÉE sort en tiret, jamais
//    en « Rp 0 » ;
//  · la matrice par jour de semaine est une vraie heatmap sur le barème
//    PARTAGÉ, avec sa LÉGENDE — un signal de couleur sans légende est un code
//    privé ;
//  · une case sans session sort un point, pas un écart nul.
//
// useCashierVariance est mocké avec un fixture stable (leçon projet : une donnée
// de mock instable alimentant des deps de useEffect fait boucler le rendu).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CashierVariancePage from '@/pages/reports/CashierVariancePage.js';
import type { CashierVarianceReport } from '@/features/reports/hooks/useCashierVariance.js';
import type * as UseCashierVarianceModule from '@/features/reports/hooks/useCashierVariance.js';
import { useAuthStore } from '@/stores/authStore.js';

const { REPORT, mockState } = vi.hoisted(() => {
  const REPORT: CashierVarianceReport = {
    generated_at: '2026-07-08T00:00:00Z',
    start_date:   '2026-06-09',
    end_date:     '2026-07-08',
    timezone:     'Asia/Jakarta',
    cashiers: [
      {
        cashier_id:     'cashier-1',
        cashier_name:   'Siti',
        sessions_count: 3,
        cash: {
          total_variance: -50_000,
          avg_variance:   -16_667,
          total_short:    50_000,
          short_count:    2,
          over_count:     0,
          worst_variance: -30_000,
        },
        qris: { counted_sessions: 0, total_variance: 0 },
        card: { counted_sessions: 0, total_variance: 0 },
        dow_cash: [{ dow: 2, sessions: 1, total_variance: -50_000 }],
      },
    ],
    totals: {
      sessions_count: 3,
      cash: { total_variance: -50_000, total_short: 50_000, short_count: 2, over_count: 0 },
      qris: { counted_sessions: 0, total_variance: 0 },
      card: { counted_sessions: 0, total_variance: 0 },
    },
  };
  const mockState: { data: CashierVarianceReport | undefined; isLoading: boolean; error: Error | null } = {
    data: REPORT,
    isLoading: false,
    error: null,
  };
  return { REPORT, mockState };
});

vi.mock('@/features/reports/hooks/useCashierVariance.js', async (orig) => {
  const actual = await orig<typeof UseCashierVarianceModule>();
  return {
    ...actual,
    useCashierVariance: () => mockState,
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/reports/cashier-variance?start=2026-06-09&end=2026-07-08']}>
        <CashierVariancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CashierVariancePage (smoke)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAuthStore.setState({ permissions: ['reports.export'] });
    mockState.data = REPORT;
    mockState.isLoading = false;
    mockState.error = null;
  });

  it('rend le fil d’Ariane, le h1 et la table par caissier avec son drill-down', () => {
    const nav = renderPage().container;
    expect(nav).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cashier Variance');
    const table = screen.getByTestId('cashier-variance-table');
    expect(within(table).getByRole('link', { name: 'Siti' }))
      .toHaveAttribute('href', '/backoffice/users/cashier-1');
    // QRIS non compté : tiret, jamais un zéro qui affirmerait un écart nul.
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('bande KPI alimentée par `totals` — un moyen non compté sort en tiret', () => {
    renderPage();
    const band = screen.getByTestId('report-kpi-band');
    for (const id of [
      'kpi-cash-variance', 'kpi-cash-short', 'kpi-sessions',
      'kpi-cashiers', 'kpi-qris-variance', 'kpi-card-variance',
    ]) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    const cash = screen.getByTestId('kpi-cash-variance');
    expect(within(cash).getByTitle('-Rp 50.000')).toBeInTheDocument();
    expect(within(cash).getByText('2 short · 0 over')).toBeInTheDocument();

    const qris = screen.getByTestId('kpi-qris-variance');
    expect(within(qris).getByText('—')).toBeInTheDocument();
    expect(within(qris).getByText('not counted at close')).toBeInTheDocument();
    expect(within(qris).queryByText(/Rp 0/)).toBeNull();
  });

  it('la matrice est une heatmap LÉGENDÉE ; une case sans session sort un point', () => {
    renderPage();
    const card = screen.getByTestId('cashier-variance-heatmap');
    expect(within(card).getByText('Cash variance by day of week')).toBeInTheDocument();

    const legend = within(card).getByTestId('variance-legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(4);
    // La légende NOMME son seuil, elle ne pose pas un adjectif.
    expect(within(legend).getByText('Short over Rp 50.000')).toBeInTheDocument();
    expect(within(legend).getByText('No session')).toBeInTheDocument();

    // Mardi porte le manquant, teinté par le barème signé. À -Rp 50.000 PILE on
    // est au seuil, pas au-delà : le barème sort « watch », et la légende dit
    // bien « short OVER Rp 50.000 » — la borne est stricte des deux côtés.
    const tuesday = within(card).getByText('-Rp 50 rb');
    expect(tuesday.className).toContain('bg-warning-soft');
    expect(within(card).getAllByText('·')).toHaveLength(6);
    expect(within(card).queryByText('Rp 0')).toBeNull();
  });

  it('renders the "No closed shifts" empty state when cashiers is empty', () => {
    mockState.data = { ...REPORT, cashiers: [] };
    renderPage();
    expect(screen.getByText('No closed shifts')).toBeInTheDocument();
    expect(screen.queryByTestId('cashier-variance-heatmap')).toBeNull();
  });

  it('chargement : squelettes de la bande, plus aucun « Loading… »', () => {
    mockState.data = undefined;
    mockState.isLoading = true;
    renderPage();
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(6);
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('erreur de garde : la bannière parle humain, pas en code', () => {
    mockState.data = undefined;
    mockState.error = new Error('permission_denied');
    renderPage();
    expect(screen.getByTestId('report-error')).toHaveTextContent(
      'You do not have permission to view this report.',
    );
    expect(screen.queryByTestId('cashier-variance-table')).toBeNull();
  });
});
