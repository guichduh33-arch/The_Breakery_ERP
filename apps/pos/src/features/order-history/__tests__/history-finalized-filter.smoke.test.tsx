// apps/pos/src/features/order-history/__tests__/history-finalized-filter.smoke.test.tsx
//
// Audit 2026-06-25 — Transaction History "délirant" regression guard.
//
// The panel listed EVERY order for the open shift (no status filter), so
// draft / pending_payment / held orders — total 0, paid_at null — inflated the
// "X transactions this shift" count, broke the KPI strip, and (NULLS-FIRST)
// floated to the top of the list. useOrderHistory now constrains the query to
// the finalized statuses. This locks that contract: the hook MUST request only
// ['paid','completed','voided'] via `.in('status', …)`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode, JSX } from 'react';
import { useOrderHistory, FINALIZED_ORDER_STATUSES } from '../hooks/useOrderHistory';
import { useShiftStore } from '@/stores/shiftStore';

const inSpy = vi.fn();

// Loose builder: record the `.in(col, vals)` call, resolve `.order()` empty.
const { fromSpy } = vi.hoisted(() => ({ fromSpy: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
  },
  supabaseUrl: 'http://localhost:54321',
}));

function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.in = (col: string, vals: readonly unknown[]) => {
    inSpy(col, vals);
    return builder;
  };
  builder.order = () => Promise.resolve({ data: [], error: null });
  return builder;
}

function makeWrapper(): (props: { children: ReactNode }) => JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  inSpy.mockClear();
  fromSpy.mockReset();
  fromSpy.mockImplementation(() => makeBuilder());
  useShiftStore.setState({
    current: { id: 'shift-1', opened_at: '2026-06-12T08:00:00.000Z', opening_cash: 0 },
  });
});

afterEach(() => {
  cleanup();
  useShiftStore.setState({ current: null });
});

describe('useOrderHistory — finalized-only filter', () => {
  it('constrains the query to paid/completed/voided', async () => {
    renderHook(() => useOrderHistory(), { wrapper: makeWrapper() });

    await waitFor(() => expect(inSpy).toHaveBeenCalled());
    expect(inSpy).toHaveBeenCalledWith('status', FINALIZED_ORDER_STATUSES);
    // The constant is exactly the finalized set — no draft / pending_payment.
    expect([...FINALIZED_ORDER_STATUSES]).toEqual(['paid', 'completed', 'voided']);
  });
});
