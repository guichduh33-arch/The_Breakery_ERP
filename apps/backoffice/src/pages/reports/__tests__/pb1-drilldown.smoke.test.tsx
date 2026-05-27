// apps/backoffice/src/pages/reports/__tests__/pb1-drilldown.smoke.test.tsx
// Session 32 / Wave 3.G — PB1 payable KPI drill-down smoke.
//
// T1 : PB1 payable card wraps the amount in a DrilldownLink pointing to
//      /accounting/general-ledger?account_id=<2110 uuid>&start&end (period).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Pb1ReportPage from '../Pb1ReportPage.js';

vi.mock('@/features/reports/hooks/usePb1Report.js', () => ({
  usePb1Report: () => ({
    data: {
      pb1_rate:      0.10,
      taxable_base:  10_000_000,
      pb1_collected: 1_000_000,
      pb1_payable:   1_000_000,
      by_day:        [],
      period:        { start: '2026-05-01', end: '2026-05-31' },
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/features/accounting/hooks/useAccountIdByCode.js', () => ({
  ACCOUNT_ID_BY_CODE_QK: ['accounting', 'account-id-by-code'],
  useAccountIdByCode: () => ({ data: 'acc-2110' }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Pb1ReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Pb1ReportPage drilldown', () => {
  it('T1 PB1 payable card wraps amount in DrilldownLink to GL with account_id=2110 uuid', () => {
    renderPage();
    const card = screen.getByTestId('pb1-payable-card');
    const link = card.querySelector('a');
    expect(link).not.toBeNull();
    const href = link?.getAttribute('href') ?? '';
    expect(href).toContain('/accounting/general-ledger');
    expect(href).toContain('account_id=acc-2110');
    expect(href).toContain('start=2026-05-01');
    expect(href).toContain('end=2026-05-31');
  });
});
