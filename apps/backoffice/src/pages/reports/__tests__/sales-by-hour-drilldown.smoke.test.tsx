// apps/backoffice/src/pages/reports/__tests__/sales-by-hour-drilldown.smoke.test.tsx
// Session 32 / Wave 3.J — SalesByHour per-hour drill-down smoke.
//
// T1 : per-hour detail table renders DrilldownLink for each non-empty hour,
//      pointing to /backoffice/orders?hour=N&start=<date>&end=<date>.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SalesByHourPage from '../SalesByHourPage.js';

vi.mock('@/features/reports/hooks/useSalesByHour.js', () => ({
  useSalesByHour: () => ({
    data: [
      { hour: 9,  total: 100_000, order_count: 2 },
      { hour: 12, total: 500_000, order_count: 5 },
      { hour: 14, total: 0,       order_count: 0 },
    ],
    isLoading: false,
    error: null,
  }),
}));

// recharts hard-crashes in jsdom because parent has zero size; stub to a div.
vi.mock('recharts', () => {
  const Noop = ({ children }: { children?: unknown }) => children as never;
  return {
    BarChart: Noop, Bar: Noop, CartesianGrid: Noop, ResponsiveContainer: Noop,
    Tooltip: Noop, XAxis: Noop, YAxis: Noop,
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SalesByHourPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SalesByHourPage drilldown', () => {
  it('T1 per-hour table renders DrilldownLink for each non-empty hour', () => {
    renderPage();
    const link9  = screen.getByRole('link', { name: '09:00' });
    const link12 = screen.getByRole('link', { name: '12:00' });
    const href9 = link9.getAttribute('href') ?? '';
    expect(href9).toContain('/backoffice/orders');
    expect(href9).toContain('hour=9');
    expect(href9).toMatch(/[?&]start=\d{4}-\d{2}-\d{2}/);
    expect(href9).toMatch(/[?&]end=\d{4}-\d{2}-\d{2}/);
    expect(link12.getAttribute('href') ?? '').toContain('hour=12');
  });
});
