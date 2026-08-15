// apps/backoffice/src/pages/reports/__tests__/production-report-page.smoke.test.tsx
//
// S40 Wave B3, révisé au lot F (campagne Reports 2026-08-15) — la page passe sur
// le socle Report shell v2 : bande de KPI, graphe journalier apparié, carte de
// ventilation par produit, et les deux tables conservées pour les quantités que
// ni le graphe ni la carte ne portent.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductionReportPage from '@/pages/reports/ProductionReportPage.js';
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
        return Promise.resolve({ data: null, error: { message: 'RPC production error' } });
      }
      if (fn === 'get_production_report_v1') {
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            summary: { runs: 12, total_produced: 480, total_waste: 24, total_value: 3_600_000 },
            by_product: [
              { product_id: 'p-1', product_name: 'Croissant', qty_produced: 300, qty_waste: 15, value: 2_250_000, runs: 8 },
              { product_id: 'p-2', product_name: 'Baguette',  qty_produced: 180, qty_waste:  9, value: 1_350_000, runs: 4 },
            ],
            by_day: [
              { date: '2026-06-10', qty_produced: 120, qty_waste: 6, value: 900_000 },
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
      <MemoryRouter><ProductionReportPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

async function loadedCard(testId: string): Promise<HTMLElement> {
  await waitFor(() => {
    expect(within(screen.getByTestId(testId)).getAllByRole('row').length).toBeGreaterThan(1);
  });
  return screen.getByTestId(testId);
}

describe('ProductionReportPage (smoke)', () => {
  beforeEach(() => { simulateError = false; });

  it('renders heading and the per-product rows', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Production Report/i, level: 1 })).toBeInTheDocument();
    const table = await loadedCard('production-by-product');
    expect(within(table).getByText('Croissant')).toBeInTheDocument();
    expect(within(table).getByText('Baguette')).toBeInTheDocument();
  });

  it('puts the headline value on the hero tile and derives the waste rate', async () => {
    renderPage();
    // 24 / 480 = 5,0 % — un rapport DÉRIVÉ, pas un champ servi.
    const rate = await screen.findByTestId('kpi-waste-rate');
    expect(rate.textContent).toMatch(/5,0%/);
    expect(screen.getByTestId('kpi-value')).toBeInTheDocument();
  });

  it('charts the daily value and keeps the daily quantities in a table', async () => {
    renderPage();
    expect(await screen.findByTestId('chart-production-by-day')).toBeInTheDocument();
    const byDay = await loadedCard('production-by-day');
    expect(within(byDay).getByText('2026-06-10')).toBeInTheDocument();
  });

  it('ventilates by product, totalling the full set', async () => {
    renderPage();
    const card = await screen.findByTestId('breakdown-production-products');
    await waitFor(() => {
      expect(within(card).getByText('Total produced')).toBeInTheDocument();
    });
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
    expect(await screen.findByTestId('report-error')).toHaveTextContent('RPC production error');
  });
});
