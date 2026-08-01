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
import type * as PaymentsByMethodModule from '@/features/reports/hooks/usePaymentsByMethod.js';

// `importOriginal` : la page consomme aussi PAYMENT_METHOD_KEYS (constante, pas
// un hook) pour ne tracer que les méthodes réellement utilisées. Un mock total
// la ferait disparaître du module.
vi.mock('@/features/reports/hooks/usePaymentsByMethod.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PaymentsByMethodModule>();
  const zeroed = Object.fromEntries(actual.PAYMENT_METHOD_KEYS.map((k) => [k, 0]));
  return {
    ...actual,
    usePaymentsByMethod: () => ({
      data: {
        lines: [
          { method: 'cash', amount: 500_000, count: 5, share_pct: 50, fee_pct: 0, fee_est: 0, net_est: 500_000 },
          { method: 'qris', amount: 500_000, count: 5, share_pct: 50, fee_pct: 0.7, fee_est: 3_500, net_est: 496_500 },
        ],
        total: 1_000_000,
        totalFees: 3_500,
        totalNet: 996_500,
        byDay: [
          { ...zeroed, day: '2026-05-25', cash: 200_000, qris: 300_000, total: 500_000 },
          { ...zeroed, day: '2026-05-26', cash: 300_000, qris: 200_000, total: 500_000 },
        ],
        period: { start: '2026-05-01', end: '2026-05-26' },
      },
      isLoading: false,
      error: null,
    }),
  };
});

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

  // Audit R-09 — la tuile du hub promet « Cash, Card, QRIS split + daily trend »
  // alors que la RPC renvoyait déjà `by_day` et que rien ne l'affichait.
  it('T2 renders the daily trend panel when by-day data is present', () => {
    renderPage();
    expect(screen.getByText('Daily trend')).toBeInTheDocument();
  });
});
