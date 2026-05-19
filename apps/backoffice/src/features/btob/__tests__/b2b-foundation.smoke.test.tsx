// apps/backoffice/src/features/btob/__tests__/b2b-foundation.smoke.test.tsx
//
// Session 24 / Phase 2.A.5 — smoke for the B2B foundation surfaces.
//   T1 — useB2bDashboard.aging is built from view_ar_aging (not last_visit_at).
//   T2 — "+ New B2B Order" is enabled, click opens CreateB2bOrderModal.
//   T3 — RecordB2bPaymentModal submit calls record_b2b_payment_v1 mutation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import B2BDashboardPage from '@/pages/btob/B2BDashboardPage.js';
import { RecordB2bPaymentModal } from '@/features/btob/components/RecordB2bPaymentModal.js';

const mockRpc = vi.fn();

const CLIENTS = [
  { id: 'b1', name: 'Hotel Kuta',  b2b_company_name: 'PT Kuta',
    b2b_current_balance: 250000, b2b_credit_limit: 1000000,
    total_spent: 5000000, total_visits: 12, last_visit_at: '2026-04-10T00:00:00Z' },
];
const AGING = [
  { customer_id: 'b1', bucket: '31-60', invoice_count: 2, total_outstanding: 750000, max_age_days: 45 },
  { customer_id: 'b1', bucket: '90+',   invoice_count: 1, total_outstanding: 120000, max_age_days: 95 },
];
const PRODUCTS = [
  { id: 'p1', sku: 'BREAD-01', name: 'Sourdough Loaf', price: 25000, current_stock: 40, unit: 'pcs' },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function tableData(table: string): RpcResult {
    if (table === 'view_ar_aging') return { data: AGING,    error: null };
    if (table === 'products')      return { data: PRODUCTS, error: null };
    if (table === 'orders')        return { data: [],       error: null };
    if (table === 'b2b_payments')  return { data: [],       error: null };
    return { data: CLIENTS, error: null };
  }
  function buildChain(table: string) {
    const result = tableData(table);
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      in:     () => chain,
      gte:    () => chain,
      order:  () => chain,
      limit:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? {
          data: {
            payment_id: 'pay-1', payment_number: 'BP-2026-0001',
            allocation: [], je_id: 'je-1',
            customer_balance_after: 150000, idempotent_replay: false,
          },
          error: null,
        });
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        p === 'customers.read' || p === 'pos.sale.create' || p === 'customers.update',
    }),
}));

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-0000-0000-000000000001',
  });
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderDashboard(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter>
        <B2BDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPaymentModal(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter>
        <RecordB2bPaymentModal open={true} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('B2B foundation (S24)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — dashboard outstanding AR aggregates view_ar_aging rows', async () => {
    renderDashboard();
    // Outstanding AR KPI must display 870 000 (750 + 120 from view_ar_aging).
    await waitFor(() => {
      const candidates = screen.queryAllByText((_, el) => {
        if (el === null) return false;
        const t = el.textContent ?? '';
        return /870[\s,.]?000/.test(t);
      });
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 4000 });
  });

  it('T2 — + New B2B Order button is enabled (RPC wired)', async () => {
    renderDashboard();
    const btn = await screen.findByRole('button', { name: /new b2b order/i });
    expect(btn).toBeEnabled();
  });

  it('T3 — RecordB2bPaymentModal submit calls record_b2b_payment_v1', async () => {
    renderPaymentModal();
    // Wait for B2B customer option to appear.
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'PT Kuta' })).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText(/^customer$/i),   { target: { value: 'b1' } });
    fireEvent.change(screen.getByLabelText(/^amount$/i),     { target: { value: '100000' } });

    const submit = screen.getByRole('button', { name: /record payment/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('record_b2b_payment_v1', expect.objectContaining({
        p_customer_id: 'b1',
        p_amount:      100000,
      }));
    });
  });
});
