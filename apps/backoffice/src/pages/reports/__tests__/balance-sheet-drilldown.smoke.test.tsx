// apps/backoffice/src/pages/reports/__tests__/balance-sheet-drilldown.smoke.test.tsx
// Session 32 / Wave 3.E — BalanceSheetPage per-account drill-down smoke test.
//
// T1 : the per-account detail table renders <DrilldownLink> entries whose href
//      points to /accounting/general-ledger?account_id=<uuid>&start&end.
//
// Lot E (campagne Reports 2026-08-15) — le drill-down survit à la migration sur
// le socle Report shell v2, et il ouvre TOUJOURS l'exercice en cours jusqu'à la
// date du bilan : un solde de bilan est cumulé, l'ouvrir sur la seule journée
// `asOf` ne montrerait jamais sa composition.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
      <MemoryRouter initialEntries={['/backoffice/reports/balance-sheet?start=2026-05-26&end=2026-05-26']}>
        <BalanceSheetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BalanceSheetPage drilldown', () => {
  it('T1 renders DrilldownLink for each per-account detail row pointing to GL', () => {
    renderPage();
    const detail = screen.getByTestId('bs-account-detail');
    const link = within(detail).getByRole('link', { name: /1110/ });
    const href = link.getAttribute('href') ?? '';
    expect(href).toContain('/accounting/general-ledger');
    expect(href).toContain('account_id=acc-1110');
    // L'exercice en cours jusqu'a la date du bilan, et non la seule journee.
    expect(href).toContain('start=2026-01-01');
    expect(href).toContain('end=2026-05-26');
  });
});
