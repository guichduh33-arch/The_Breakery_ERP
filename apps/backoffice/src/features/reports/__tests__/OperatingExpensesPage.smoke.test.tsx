// apps/backoffice/src/features/reports/__tests__/OperatingExpensesPage.smoke.test.tsx
//
// Lot E (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2. Ce fichier tient, au-delà du « ça rend » :
//
//  · PLUS AUCUN « Rp 0 » AU-DESSUS D'UN CHARGEMENT — la bande sort des
//    squelettes, pas des zéros qui affirmeraient qu'aucune dépense n'existe ;
//  · la comparaison est requêtée AVEC LES MÊMES FILTRES : comparer « toutes
//    catégories » à « loyer » ne dirait rien ;
//  · la hausse d'un coût se lit en MAUVAISE nouvelle (`invert`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();
let rowsEmpty = false;

// expense_categories list — chainable .select().eq().order() resolving to data.
function categoriesQuery() {
  const result = { data: [{ id: 'e1', name: 'Rent', code: 'RENT', is_active: true }], error: null };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq     = () => chain;
  chain.order  = () => Promise.resolve(result);
  return chain;
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => categoriesQuery(),
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_expenses_by_category_v1') {
        return Promise.resolve({
          data: rowsEmpty
            ? {
                period: { start: args.p_date_start, end: args.p_date_end },
                summary: { total: 0, count: 0, avg: 0 },
                by_category: [], by_day: [],
              }
            : {
                period: { start: args.p_date_start, end: args.p_date_end },
                summary: { total: 150_000, count: 2, avg: 75_000 },
                by_category: [
                  { category_id: 'e1', code: 'RENT', name: 'Rent', total: 100_000, count: 1, share_pct: 66.7 },
                  { category_id: 'e2', code: 'UTIL', name: 'Utilities', total: 50_000, count: 1, share_pct: 33.3 },
                ],
                by_day: [{ date: '2026-06-02', total: 150_000 }],
              },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import OperatingExpensesPage from '@/pages/reports/OperatingExpensesPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

const START = '2026-06-01';
const END   = '2026-06-07';

function renderPage(search = `?start=${START}&end=${END}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/operating-expenses${search}`]}>
        <OperatingExpensesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function expenseCalls(): Record<string, unknown>[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_expenses_by_category_v1')
    .map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
  rowsEmpty = false;
});

describe('OperatingExpensesPage (smoke)', () => {
  it('renders the heading and queries get_expenses_by_category_v1 with date bounds', async () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Operating Expenses', level: 1 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(expenseCalls().length).toBeGreaterThanOrEqual(1);
    });
    for (const args of expenseCalls()) {
      expect(String(args.p_date_start)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(args.p_date_end)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('interroge la periode precedente AVEC les memes filtres', async () => {
    renderPage(`?start=${START}&end=${END}&category_id=e1&status=paid`);
    await waitFor(() => {
      expect(expenseCalls().length).toBeGreaterThanOrEqual(2);
    });
    const windows = expenseCalls().map((a) => `${String(a.p_date_start)}..${String(a.p_date_end)}`);
    expect(windows).toContain(`${START}..${END}`);
    expect(windows).toContain('2026-05-25..2026-05-31');
    for (const args of expenseCalls()) {
      expect(args.p_category_id).toBe('e1');
      expect(args.p_status).toBe('paid');
    }
  });

  it('bande KPI : total en hero, une hausse de cout lue en mauvaise nouvelle', async () => {
    renderPage();
    await screen.findByTestId('kpi-total');
    const band = screen.getByTestId('report-kpi-band');
    for (const id of ['kpi-total', 'kpi-entries', 'kpi-avg-entry', 'kpi-categories', 'kpi-top-category']) {
      expect(within(band).getByTestId(id)).toBeInTheDocument();
    }
    // La periode precedente est identique : variation nulle, donc « unchanged ».
    expect(within(band).getAllByText(/unchanged versus prev/).length).toBeGreaterThan(0);
    expect(within(band).getByTestId('kpi-top-category')).toHaveTextContent('Rent');
  });

  it('aucune tuile ne montre un zero pendant le chargement', () => {
    renderPage();
    // Premier rendu : la requete n'a pas repondu — squelettes, pas de « Rp 0 ».
    expect(screen.getAllByTestId('kpi-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('Rp 0')).toBeNull();
  });

  it('un seul graphe, et la ventilation par categorie en carte', async () => {
    renderPage();
    await screen.findByRole('img', { name: /Operating expense per day/ });
    expect(screen.getByTestId('chart-opex-by-day')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Operating expense per day/ })).toHaveLength(1);
    const card = screen.getByTestId('breakdown-opex-categories');
    expect(within(card).getByRole('img', { name: /Share of operating expense/ })).toBeInTheDocument();
  });

  it('shows the canonical empty state when nothing matches', async () => {
    rowsEmpty = true;
    renderPage();
    expect(await screen.findByText('No expenses')).toBeInTheDocument();
    expect(screen.queryByTestId('opex-category-detail')).toBeNull();
  });
});
