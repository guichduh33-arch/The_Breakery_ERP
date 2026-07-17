// apps/pos/src/features/order-history/__tests__/OrderRetryBanner.test.tsx
//
// Session 13 / Phase 4.A — banner surfaces only when JE missing on a paid
// order, and one-click retry invokes retry_sale_journal_entry_v2.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrderRetryBanner } from '../components/OrderRetryBanner';

// ─── Mocks ──────────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file — variables referenced in the
// factory must be declared inside, not in module scope. We use a vi.hoisted
// container so the mock body can read the same singleton our tests do.

const { toastMock, rpcMock, probeState } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  rpcMock: vi.fn(),
  probeState: { current: { count: 0, error: null as { message: string } | null } },
}));

vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

// Build a chainable PostgREST-like select() builder. The probe hook calls
//   from('journal_entries').select('id', { count: 'exact', head: true })
//     .eq('reference_id', orderId).eq('reference_type', 'sale')
// and awaits the resulting builder, expecting { data, error, count }.
vi.mock('@/lib/supabase', () => {
  // Chainable PostgREST-like builder. Returns a thenable so `await builder`
  // yields { data, error, count } from the probe singleton.
  const makeBuilder = () => {
    const builder: {
      eq: (col: string, val: unknown) => typeof builder;
      then: <R>(fn: (qr: { data: null; error: { message: string } | null; count: number }) => R) => Promise<R>;
    } = {
      eq: () => builder,
      then: (fn) => Promise.resolve(fn({
        data: null,
        error: probeState.current.error,
        count: probeState.current.count,
      })),
    };
    return builder;
  };
  return {
    supabase: {
      from: (_table: string) => ({
        select: (_cols: string, _opts?: unknown) => makeBuilder(),
      }),
      rpc: (...args: unknown[]) => rpcMock(...args) as unknown,
    },
  };
});

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('OrderRetryBanner', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.info.mockReset();
    probeState.current = { count: 0, error: null };
  });

  it('renders nothing for non-paid orders', () => {
    render(withQuery(<OrderRetryBanner orderId="o1" status="voided" />));
    expect(screen.queryByTestId('order-retry-banner')).toBeNull();
  });

  it('renders the banner when JE is missing on a paid order', async () => {
    probeState.current = { count: 0, error: null };
    render(withQuery(<OrderRetryBanner orderId="o1" status="paid" />));
    await waitFor(() => {
      expect(screen.getByTestId('order-retry-banner')).toBeInTheDocument();
    });
    expect(screen.getByText(/Accounting entry missing/i)).toBeInTheDocument();
  });

  it('hides the banner when a JE already exists', async () => {
    probeState.current = { count: 1, error: null };
    render(withQuery(<OrderRetryBanner orderId="o1" status="paid" />));
    // Wait long enough for the probe to settle ; nothing should appear.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByTestId('order-retry-banner')).toBeNull();
  });

  it('calls retry_sale_journal_entry_v2 on click and shows success toast', async () => {
    probeState.current = { count: 0, error: null };
    rpcMock.mockResolvedValue({
      data: {
        order_id: 'o1',
        journal_entry_id: 'je-1',
        created: true,
        idempotent_replay: false,
      },
      error: null,
    });

    render(withQuery(<OrderRetryBanner orderId="o1" status="paid" />));
    const btn = await screen.findByTestId('order-retry-banner-button');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('retry_sale_journal_entry_v2', { p_order_id: 'o1' });
    });
    await waitFor(() => {
      expect(toastMock.success).toHaveBeenCalled();
    });
  });

  it('shows info toast when server flags idempotent_replay=true', async () => {
    probeState.current = { count: 0, error: null };
    rpcMock.mockResolvedValue({
      data: {
        order_id: 'o1',
        journal_entry_id: 'je-1',
        created: false,
        idempotent_replay: true,
      },
      error: null,
    });

    render(withQuery(<OrderRetryBanner orderId="o1" status="paid" />));
    const btn = await screen.findByTestId('order-retry-banner-button');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(toastMock.info).toHaveBeenCalled();
    });
  });

  it('shows error toast on RPC failure', async () => {
    probeState.current = { count: 0, error: null };
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission_denied' } });

    render(withQuery(<OrderRetryBanner orderId="o1" status="paid" />));
    const btn = await screen.findByTestId('order-retry-banner-button');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
  });
});
