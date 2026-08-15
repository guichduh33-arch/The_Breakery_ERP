// apps/backoffice/src/pages/reports/__tests__/pb1-drilldown.smoke.test.tsx
// Session 32 / Wave 3.G — PB1 payable KPI drill-down smoke.
//
// T1 : the PB1 payable tile points at
//      /accounting/general-ledger?account_id=<2110 uuid>&start&end (period).
//
// Lot E (campagne Reports 2026-08-15) — la tuile ELLE-MÊME est désormais le
// lien, au lieu d'un lien niché dans une carte : la zone cliquable couvre la
// tuile et le focus se dessine autour d'elle (KpiTile `to`).

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
      balance_account_code:  '2110',
      balance_at_period_end: 1_000_000,
      period:        { month: 5, year: 2026, start: '2026-05-01', end: '2026-05-31' },
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/features/accounting/hooks/useAccountIdByCode.js', () => ({
  ACCOUNT_ID_BY_CODE_QK: ['accounting', 'account-id-by-code'],
  useAccountIdByCode: () => ({ data: 'acc-2110' }),
}));

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/reports/pb1?start=2026-05-01&end=2026-05-31']}>
        <Pb1ReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Pb1ReportPage drilldown', () => {
  it('T1 the PB1 payable tile is the link to the GL of account 2110', () => {
    renderPage();
    const tile = screen.getByTestId('pb1-payable-card');
    expect(tile.tagName).toBe('A');
    const href = tile.getAttribute('href') ?? '';
    expect(href).toContain('/accounting/general-ledger');
    expect(href).toContain('account_id=acc-2110');
    expect(href).toContain('start=2026-05-01');
    expect(href).toContain('end=2026-05-31');
  });
});
