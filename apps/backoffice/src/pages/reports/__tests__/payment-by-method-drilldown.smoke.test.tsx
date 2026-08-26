// apps/backoffice/src/pages/reports/__tests__/payment-by-method-drilldown.smoke.test.tsx
// Session 32 / Wave 3.I — PaymentByMethod method drill-down smoke.
//
// T1 : method cell wraps in <DrilldownLink entity="order_list"> pointing to
//      /backoffice/orders?payment_method=<method>&start=<>&end=<>.
//
// Lot E (campagne Reports 2026-08-15) — le drill-down existe désormais à DEUX
// endroits : la carte de ventilation (libellé capitalisé) et la table de détail
// (la CLÉ de l'enum Postgres, en minuscules, jamais réécrite côté TS). Les deux
// pointent au même endroit.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
        totalCount: 10,
        totalOrders: 9,
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
      <MemoryRouter initialEntries={['/backoffice/reports/payment-by-method?start=2026-05-01&end=2026-05-26']}>
        <PaymentByMethodPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentByMethodPage drilldown', () => {
  // Le LIBELLÉ du lien et la CLÉ du filtre sont deux choses différentes, et ce
  // test est l'endroit où ça se prouve : on lit « QRIS » (map partagée de
  // `features/orders/statusMeta`), on filtre sur `qris` (jeton d'enum Postgres).
  // La table rendait le jeton brut sous un `capitalize` CSS jusqu'au
  // 2026-08-26 — « Qris » à l'écran, à côté d'une carte de ventilation qui
  // écrivait déjà « QRIS ». Le test épinglait cet état ; il épingle maintenant
  // la séparation.
  it('T1 each method cell wraps in DrilldownLink to /backoffice/orders?payment_method=...', () => {
    renderPage();
    const detail = screen.getByTestId('pbm-method-detail');
    const cashLink = within(detail).getByRole('link', { name: 'Cash' });
    const href = cashLink.getAttribute('href') ?? '';
    expect(href).toContain('/backoffice/orders');
    expect(href).toContain('payment_method=cash');
    expect(href).toMatch(/[?&]start=\d{4}-\d{2}-\d{2}/);
    expect(href).toMatch(/[?&]end=\d{4}-\d{2}-\d{2}/);

    const qrisLink = within(detail).getByRole('link', { name: 'QRIS' });
    expect(qrisLink.getAttribute('href') ?? '').toContain('payment_method=qris');
  });

  it('T2 renders the daily trend panel when by-day data is present', () => {
    renderPage();
    expect(screen.getByText('Daily trend')).toBeInTheDocument();
    expect(screen.getByTestId('chart-payments-by-day')).toBeInTheDocument();
  });

  it('T3 la carte de ventilation mene au meme filtre, sous un libelle lisible', () => {
    renderPage();
    const card = screen.getByTestId('breakdown-methods');
    const link = within(card).getByRole('link', { name: 'Cash' });
    expect(link.getAttribute('href') ?? '').toContain('payment_method=cash');
    expect(within(card).getByText(/10 payments across 9 orders/)).toBeInTheDocument();
  });
});
