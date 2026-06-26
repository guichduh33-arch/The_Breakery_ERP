// apps/pos/src/features/order-history/__tests__/history-refetch-on-open.smoke.test.tsx
//
// Session 43 — Wave D — P1-3 smokes.
//
//   T1. OrderHistoryPanel is mounted permanently; opening it must force a
//       refetch of useOrderHistory (real hook, mocked supabase) so the list
//       and the KPI strip (same query) aren't frozen at last-mount data.
//   T2/T3. OrderDetailDrawer "Remaining" = outstanding balance due, not the
//       gross total: a fully-paid order shows Rp 0; an unpaid order shows
//       total minus the sum of its tenders.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode, JSX } from 'react';
import { OrderHistoryPanel } from '../OrderHistoryPanel';
import { OrderDetailDrawer } from '../components/OrderDetailDrawer';
import type { OrderDetail } from '../hooks/useOrderDetail';
import { useShiftStore } from '@/stores/shiftStore';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

// Loose supabase mock: `.from(table).select(...).eq(...).order(...)` resolves
// with empty rows (useOrderHistory), and the builder itself is thenable so
// count-only probes (useOrderRetryStatus on journal_entries) resolve too.
const { fromSpy } = vi.hoisted(() => {
  function makeBuilder(table: string): Record<string, unknown> {
    const result =
      table === 'journal_entries'
        ? { data: null, error: null, count: 1 } // JE present → no retry banner fetch loop
        : { data: [], error: null, count: 0 };
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.in = () => builder;
    builder.order = () => Promise.resolve(result);
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    builder.single = () => Promise.resolve({ data: null, error: null });
    builder.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject);
    return builder;
  }
  return { fromSpy: vi.fn((table: string) => makeBuilder(table)) };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
  supabaseUrl: 'http://localhost:54321',
}));

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function ordersFetchCount(): number {
  return fromSpy.mock.calls.filter(([table]) => table === 'orders').length;
}

beforeEach(() => {
  fromSpy.mockClear();
  useShiftStore.setState({
    current: { id: 'shift-1', opened_at: '2026-06-12T08:00:00.000Z', opening_cash: 0 },
  });
});

afterEach(() => {
  cleanup();
  useShiftStore.setState({ current: null });
});

describe('OrderHistoryPanel — refetch on open (P1-3)', () => {
  it('refetches the history when the panel opens', async () => {
    const Wrapper = makeWrapper();
    const { rerender } = render(
      <Wrapper>
        <OrderHistoryPanel open={false} onClose={vi.fn()} />
      </Wrapper>,
    );

    // The panel is permanently mounted → the query fires once on mount.
    await waitFor(() => expect(ordersFetchCount()).toBeGreaterThan(0));
    const callsBefore = ordersFetchCount();

    rerender(
      <Wrapper>
        <OrderHistoryPanel open onClose={vi.fn()} />
      </Wrapper>,
    );

    await waitFor(() => expect(ordersFetchCount()).toBeGreaterThan(callsBefore));
  });
});

// ---------------------------------------------------------------------------
// Remaining = outstanding balance, not gross total (P1-3)
// ---------------------------------------------------------------------------

function buildDetail(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-1',
    order_number: '#1001',
    status: 'paid',
    total: 50_000,
    tax_amount: 4_545,
    customer_id: null,
    table_number: null,
    paid_at: '2026-06-12T10:00:00.000Z',
    voided_at: null,
    void_reason: null,
    items: [
      {
        id: 'oi-1',
        product_id: 'p-1',
        name_snapshot: 'Americano',
        quantity: 1,
        line_total: 50_000,
        is_cancelled: false,
        qty_already_refunded: 0,
      },
    ],
    payments: [{ id: 'pay-1', method: 'cash', amount: 50_000, reference: null }],
    refunded_by_method: {},
    total_refunded: 0,
    ...overrides,
  };
}

function remainingRow(): HTMLElement {
  const label = screen.getByText('Remaining');
  return label.parentElement as HTMLElement;
}

describe('OrderDetailDrawer — Remaining shows the balance due (P1-3)', () => {
  it('shows Rp 0 on a fully-paid order', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <OrderDetailDrawer order={buildDetail()} onVoidClick={vi.fn()} onRefundClick={vi.fn()} />
      </Wrapper>,
    );
    expect(within(remainingRow()).getByText('Rp 0')).toBeInTheDocument();
  });

  it('shows total minus tenders on a not-yet-paid order', () => {
    const Wrapper = makeWrapper();
    const order = buildDetail({
      status: 'draft',
      paid_at: null,
      payments: [{ id: 'pay-1', method: 'cash', amount: 20_000, reference: null }],
    });
    render(
      <Wrapper>
        <OrderDetailDrawer order={order} onVoidClick={vi.fn()} onRefundClick={vi.fn()} />
      </Wrapper>,
    );
    expect(within(remainingRow()).getByText('Rp 30,000')).toBeInTheDocument();
  });
});
