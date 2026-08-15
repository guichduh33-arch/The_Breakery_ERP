// apps/backoffice/src/pages/reports/__tests__/PerishableTurnoverPage.smoke.test.tsx
//
// Lot J (campagne Reports 2026-08-15) — la RPC `get_perishable_turnover_v1`
// entre enfin dans une page. Ce que ce fichier tient sous contrat :
//
//  · la RPC reçoit des bornes MÉTIER, et UNE seule fenêtre — la page ne pose pas
//    de comparaison, la moitié des colonnes servies n'étant pas période-scopée ;
//  · le taux de perte global se recompose des QUANTITÉS, jamais d'une moyenne
//    des `waste_pct` par produit (ici 22/(322+22) = 6,4 %, quand la moyenne des
//    deux lignes donnerait 52,7 %) ;
//  · une durée inconnue reste un tiret dans la table ;
//  · la table est triable et le produit ouvre son drill-down ;
//  · l'export CSV est atteignable, et il n'y a PAS d'entrée PDF (aucun gabarit
//    `perishable-turnover` dans le registre de l'EF `generate-pdf`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mockRpc = vi.fn();

function payload() {
  return {
    period: { start: '2026-04-25', end: '2026-05-25' },
    by_product: [
      {
        product_id: 'p-1', product_name: 'Croissant',
        lots_count: 42, consumed_qty: 310, expired_qty: 18,
        current_active_qty: 24, waste_pct: 5.49,
        avg_days_in_stock: 1.75, shelf_life_days_p50: 3, velocity_score: 5,
      },
      {
        product_id: 'p-2', product_name: 'Sourdough Loaf',
        lots_count: 6, consumed_qty: 12, expired_qty: 4,
        current_active_qty: 2, waste_pct: 100,
        avg_days_in_stock: null, shelf_life_days_p50: null, velocity_score: 1,
      },
    ],
  };
}

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_perishable_turnover_v1') {
        return Promise.resolve({ data: payload(), error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import PerishableTurnoverPage from '@/pages/reports/PerishableTurnoverPage.js';
import { useAuthStore } from '@/stores/authStore.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage(search = '?start=2026-04-25&end=2026-05-25') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/perishable-turnover${search}`]}>
        <PerishableTurnoverPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function turnoverCalls(): { p_date_start: string; p_date_end: string }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_perishable_turnover_v1')
    .map(([, args]) => args as { p_date_start: string; p_date_end: string });
}

/** Attend la table CHARGÉE : la PanelCard existe dès le montage, son corps
 *  n'est alors qu'un squelette. */
async function loadedTable(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(within(screen.getByTestId('perishable-table')).getAllByRole('row').length)
      .toBeGreaterThan(1);
  });
  return screen.getByTestId('perishable-table');
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  mockRpc.mockReset();
  sessionStorage.clear();
});

describe('PerishableTurnoverPage (smoke)', () => {
  it('renders the page heading', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /Perishable Turnover/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it('calls get_perishable_turnover_v1 with business-date bounds', async () => {
    renderPage();
    await waitFor(() => { expect(turnoverCalls().length).toBeGreaterThan(0); });
    for (const args of turnoverCalls()) {
      expect(args.p_date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(turnoverCalls().some((a) => a.p_date_start === '2026-04-25')).toBe(true);
  });

  // Pas de comparaison : `current_active_qty`, `shelf_life_days_p50` et
  // `lots_count` ne sont pas bornés par la fenêtre côté RPC — une variation à
  // 0 % sur ces tuiles se lirait comme « rien n'a bougé ».
  it('queries a single window and offers no Compare control', async () => {
    renderPage();
    await waitFor(() => { expect(turnoverCalls().length).toBeGreaterThan(0); });
    const windows = new Set(turnoverCalls().map((a) => `${a.p_date_start}|${a.p_date_end}`));
    expect(windows.size).toBe(1);
    expect(screen.queryByTestId('compare-toggle')).toBeNull();
  });

  it('recomposes the waste rate from quantities, not from an average of per-product rates', async () => {
    renderPage();
    // 22 unités périmées sur 344 fermées = 6,4 % ; la moyenne de 5,49 et 100
    // donnerait 52,7 %, ce qui serait faux.
    const hero = await screen.findByTestId('kpi-waste-rate');
    expect(hero.textContent).toMatch(/6,4%/);
    expect(hero.textContent).toMatch(/22 of 344 units expired/);
  });

  it('names the slowest mover from a served value', async () => {
    renderPage();
    const tile = await screen.findByTestId('kpi-slowest');
    expect(tile.textContent).toMatch(/Croissant/);
    expect(tile.textContent).toMatch(/1,75 days/);
  });

  it('renders one row per product and drills down on the product', async () => {
    renderPage();
    const table = await loadedTable();
    expect(within(table).getByText('Croissant')).toBeInTheDocument();
    const link = within(table).getByText('Sourdough Loaf').closest('a');
    expect(link?.getAttribute('href')).toContain('p-2');
  });

  it('shows a dash where the RPC could not measure a duration', async () => {
    renderPage();
    const table = await loadedTable();
    const row = within(table).getAllByRole('row')
      .find((r) => r.textContent?.includes('Sourdough Loaf'));
    expect(row).toBeDefined();
    // colonnes : Product | Lots | Consumed | Expired | Waste | Avg days | Shelf | On hand | Velocity
    const cells = row!.querySelectorAll('td');
    expect(cells[5]?.textContent).toBe('—');
    expect(cells[6]?.textContent).toBe('—');
  });

  it('re-ranks the table when a column header is clicked', async () => {
    renderPage();
    const table = await loadedTable();
    const firstProduct = (): string | undefined =>
      within(table).getAllByRole('row')[1]?.querySelector('td')?.textContent ?? undefined;

    expect(firstProduct()).toBe('Croissant');
    fireEvent.click(within(table).getByTestId('sort-product'));
    expect(firstProduct()).toBe('Croissant'); // asc alphabétique : C avant S
    fireEvent.click(within(table).getByTestId('sort-product'));
    expect(firstProduct()).toBe('Sourdough Loaf');
  });

  it('renders the paired days-vs-shelf-life chart', async () => {
    renderPage();
    expect(await screen.findByTestId('chart-perishable-days')).toBeInTheDocument();
  });

  it('offers CSV only — no PDF template exists for this report', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });
});
