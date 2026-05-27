// apps/backoffice/src/pages/reports/__tests__/balance-sheet-drilldown.smoke.test.tsx
// Session 32 / Wave 3.E — BalanceSheetPage per-account drill-down smoke test.
//
// T1 : the per-account detail table renders <DrilldownLink> entries whose href
//      points to /accounting/general-ledger?account_id=<uuid>&start=<asOf>&end=<asOf>.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BalanceSheetPage from '../BalanceSheetPage.js';

vi.mock('@/features/reports/hooks/useBalanceSheet.js', () => ({
  BALANCE_SHEET_QK: ['reports', 'balance-sheet'],
  useBalanceSheet: () => ({
    data: {
      assets: {
        current: { cash: 1_000_000, ar: 0, inventory: 0, other: 0, total: 1_000_000 },
        fixed:   { total: 0 },
        total:   1_000_000,
      },
      liabilities: {
        current:   { ap: 0, tax_payable: 0, loyalty: 0, other: 0, total: 0 },
        long_term: { total: 0 },
        total:     0,
      },
      equity: {
        share_capital:         1_000_000,
        retained_earnings:     0,
        current_year_earnings: 0,
        other:                 0,
        total:                 1_000_000,
      },
      balanced: true,
      delta:    0,
      as_of:    '2026-05-26',
      lines: [
        {
          account_id:    'acc-1110',
          code:          '1110',
          name:          'Cash on hand',
          debit:         1_000_000,
          credit:        0,
          balance:       1_000_000,
          account_class: 1,
        },
      ],
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
        <BalanceSheetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BalanceSheetPage drilldown', () => {
  it('T1 renders DrilldownLink for each per-account detail row pointing to GL', () => {
    renderPage();
    const link = screen.getByRole('link', { name: /1110/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/accounting/general-ledger');
    expect(href).toContain('account_id=acc-1110');
    expect(href).toMatch(/[?&]start=\d{4}-\d{2}-\d{2}/);
    expect(href).toMatch(/[?&]end=\d{4}-\d{2}-\d{2}/);
  });
});
