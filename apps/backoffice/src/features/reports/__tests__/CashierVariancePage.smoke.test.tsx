// apps/backoffice/src/features/reports/__tests__/CashierVariancePage.smoke.test.tsx
// S70 — smoke test for the read-only Cashier Variance report page (fiche 12 D2.4).
//
// useCashierVariance is mocked with a stable vi.hoisted fixture (project lesson:
// unstable mock data feeding useEffect deps OOMs render loops — see
// stock-analytics-panel.smoke.test.tsx for the canonical pattern).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import CashierVariancePage from '@/pages/reports/CashierVariancePage.js';
import type { CashierVarianceReport } from '@/features/reports/hooks/useCashierVariance.js';
import type * as UseCashierVarianceModule from '@/features/reports/hooks/useCashierVariance.js';

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
      <MemoryRouter><CashierVariancePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CashierVariancePage (smoke)', () => {
  beforeEach(() => {
    mockState.data = REPORT;
    mockState.isLoading = false;
    mockState.error = null;
  });

  it('renders cashier name, "—" for uncounted QRIS, and the day-of-week heading', () => {
    renderPage();
    // "Siti" appears once per table (summary + day-of-week breakdown).
    expect(screen.getAllByText('Siti').length).toBeGreaterThan(0);
    expect(screen.getByText('Cash variance by day of week')).toBeInTheDocument();
    // QRIS column: counted_sessions === 0 → em dash rendered instead of a number
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders the "No closed shifts" empty state when cashiers is empty', () => {
    mockState.data = { ...REPORT, cashiers: [] };
    mockState.isLoading = false;
    mockState.error = null;
    renderPage();
    expect(screen.getByText('No closed shifts')).toBeInTheDocument();
  });

  it('renders "Loading…" while the report is loading', () => {
    mockState.data = undefined;
    mockState.isLoading = true;
    mockState.error = null;
    renderPage();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
