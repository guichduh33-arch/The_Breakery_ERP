// apps/backoffice/src/features/accounting/__tests__/ar-aging.smoke.test.tsx
//
// Session 26c / Wave 2 — smoke for ARAgingPage.
//   T1 — Pivots 2 rows (same customer, 2 buckets) into 1 line with correct totals.
//   T2 — Grand total sums all outstanding across customers.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ARAgingPage from '@/features/accounting/pages/ARAgingPage.js';

const AGING = [
  // Hotel Kuta : current 200000 + 31-60 750000 + 90+ 120000 = 1070000, 4 invoices
  { customer_id: 'c1', b2b_company_name: 'PT Hotel Kuta', customer_name: null,
    bucket: 'current', invoice_count: 1, total_outstanding: 200000,
    min_age_days: 5, max_age_days: 20 },
  { customer_id: 'c1', b2b_company_name: 'PT Hotel Kuta', customer_name: null,
    bucket: '31-60', invoice_count: 2, total_outstanding: 750000,
    min_age_days: 35, max_age_days: 58 },
  { customer_id: 'c1', b2b_company_name: 'PT Hotel Kuta', customer_name: null,
    bucket: '90+', invoice_count: 1, total_outstanding: 120000,
    min_age_days: 95, max_age_days: 95 },
  // Resto B : 61-90 300000, 1 invoice
  { customer_id: 'c2', b2b_company_name: 'PT Resto B', customer_name: null,
    bucket: '61-90', invoice_count: 1, total_outstanding: 300000,
    min_age_days: 75, max_age_days: 75 },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function buildChain() {
    const result: RpcResult = { data: AGING, error: null };
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      order:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain(),
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter>
        <ARAgingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ARAgingPage (S26c Wave 2)', () => {
  it('T1 — pivots 3 rows for one customer into a single line with bucket totals', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('ar-aging-row-c1')).not.toBeNull();
    });
    const row = screen.getByTestId('ar-aging-row-c1');
    // current 200000, 31-60 750000, 90+ 120000, total 1.070.000
    expect(row.textContent).toContain('200.000');
    expect(row.textContent).toContain('750.000');
    expect(row.textContent).toContain('120.000');
    expect(row.textContent).toContain('1.070.000');
  });

  it('T2 — grand total across all customers (1070000 + 300000 = 1370000)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('ar-aging-grand-total')).not.toBeNull();
    });
    expect(screen.getByTestId('ar-aging-grand-total').textContent).toBe('1.370.000');
  });
});
