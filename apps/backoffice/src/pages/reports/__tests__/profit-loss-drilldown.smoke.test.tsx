// apps/backoffice/src/pages/reports/__tests__/profit-loss-drilldown.smoke.test.tsx
// Session 32 / Wave 3.D — ProfitLossPage account drill-down smoke test.
//
// T1 : the account code cell is rendered as a <DrilldownLink> whose href
//      points to /accounting/general-ledger with the account_id UUID and
//      start/end query params propagated from the page filter state.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfitLossPage from '../ProfitLossPage.js';

vi.mock('@/features/reports/hooks/useProfitLoss.js', () => ({
  PROFIT_LOSS_QK: ['reports', 'profit-loss'],
  useProfitLoss: () => ({
    data: {
      revenue: { sales: 0, discounts: 0, adjustments: 0, total: 0 },
      cogs:    { production: 0, waste: 0, other: 0, total: 0 },
      gross_profit: 0,
      opex: { salary: 0, rent: 0, utilities: 0, supplies: 0, marketing: 0, maintenance: 0, other: 0, total: 0 },
      operating_profit: 0,
      net_profit: 0,
      lines: [
        {
          account_id:    'acc-xyz',
          code:          '4100',
          name:          'Sales Revenue',
          debit:         0,
          credit:        100000,
          balance:       100000,
          account_class: 4,
        },
      ],
      period: { start: '2026-05-01', end: '2026-05-26', section_id: null },
    },
    isLoading: false,
    error: null,
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProfitLossPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfitLossPage drilldown', () => {
  it('T1 wraps account code cell with DrilldownLink to /accounting/general-ledger?account_id=', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /4100/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/accounting/general-ledger');
    expect(href).toContain('account_id=acc-xyz');
    expect(href).toMatch(/[?&]start=\d{4}-\d{2}-\d{2}/);
    expect(href).toMatch(/[?&]end=\d{4}-\d{2}-\d{2}/);
  });
});
