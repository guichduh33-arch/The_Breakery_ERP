// apps/backoffice/src/pages/reports/__tests__/payment-by-method-drilldown.smoke.test.tsx
// Session 32 / Wave 3.I — PaymentByMethod method drill-down smoke.
//
// T1 : method cell wraps in <DrilldownLink entity="order_list"> pointing to
//      /backoffice/orders?payment_method=<method>&start=<>&end=<>.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentByMethodPage from '../PaymentByMethodPage.js';

vi.mock('@/features/reports/hooks/usePaymentsByMethod.js', () => ({
  usePaymentsByMethod: () => ({
    data: {
      lines: [
        { method: 'cash', amount: 500_000, count: 5, share_pct: 50 },
        { method: 'qris', amount: 500_000, count: 5, share_pct: 50 },
      ],
      total: 1_000_000,
      by_day: [],
      period: { start: '2026-05-01', end: '2026-05-26' },
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
        <PaymentByMethodPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentByMethodPage drilldown', () => {
  it('T1 each method cell wraps in DrilldownLink to /backoffice/orders?payment_method=...', () => {
    renderPage();
    const cashLink = screen.getByRole('link', { name: 'cash' });
    const href = cashLink.getAttribute('href') ?? '';
    expect(href).toContain('/backoffice/orders');
    expect(href).toContain('payment_method=cash');
    expect(href).toMatch(/[?&]start=\d{4}-\d{2}-\d{2}/);
    expect(href).toMatch(/[?&]end=\d{4}-\d{2}-\d{2}/);

    const qrisLink = screen.getByRole('link', { name: 'qris' });
    expect(qrisLink.getAttribute('href') ?? '').toContain('payment_method=qris');
  });
});
