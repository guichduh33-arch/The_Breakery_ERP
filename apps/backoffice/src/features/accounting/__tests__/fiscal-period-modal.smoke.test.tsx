// apps/backoffice/src/features/accounting/__tests__/fiscal-period-modal.smoke.test.tsx
//
// Session 26b / Wave 5 — smoke for FiscalPeriodModal.
//   T1 — Modal requires PIN (6 digits) before RPC fires.
//   T2 — Submit calls close_fiscal_period_v1 with p_lock=true when checkbox is ticked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FiscalPeriodModal } from '@/features/accounting/components/FiscalPeriodModal.js';

const mockRpc = vi.fn();

const PERIODS = [
  { id: 'p1', period_start: '2026-04-01', period_end: '2026-04-30',
    status: 'open', closed_at: null, locked_at: null },
  { id: 'p2', period_start: '2026-03-01', period_end: '2026-03-31',
    status: 'closed', closed_at: '2026-04-05T10:00:00Z', locked_at: null },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function buildChain() {
    const result: RpcResult = { data: PERIODS, error: null };
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      order:  () => chain,
      limit:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain(),
      rpc:  (fn: string, args: unknown) => Promise.resolve(mockRpc(fn, args) ?? {
        data: { period_id: 'p1', new_status: 'locked' }, error: null,
      }),
    },
  };
});

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <FiscalPeriodModal onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('FiscalPeriodModal (S26b Wave 5)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — PIN must be 6 digits ; bad PIN surfaces inline error, no RPC', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /2026-04-01/i })).not.toBeNull();
    });

    fireEvent.change(screen.getByTestId('fp-modal-period-select'),
      { target: { value: 'p1' } });
    fireEvent.click(screen.getByTestId('fp-modal-next'));

    await waitFor(() => {
      expect(screen.queryByTestId('fp-modal-pin')).not.toBeNull();
    });
    fireEvent.change(screen.getByTestId('fp-modal-pin'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('fp-modal-submit'));

    await waitFor(() => {
      const errEl = screen.queryByTestId('fp-modal-error');
      expect(errEl).not.toBeNull();
      expect(errEl?.textContent ?? '').toMatch(/6 digits/i);
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('T2 — submit calls close_fiscal_period_v1 with p_lock=true when checkbox ticked', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /2026-04-01/i })).not.toBeNull();
    });

    fireEvent.change(screen.getByTestId('fp-modal-period-select'),
      { target: { value: 'p1' } });
    fireEvent.click(screen.getByTestId('fp-modal-lock-checkbox'));
    fireEvent.click(screen.getByTestId('fp-modal-next'));

    await waitFor(() => {
      expect(screen.queryByTestId('fp-modal-pin')).not.toBeNull();
    });
    fireEvent.change(screen.getByTestId('fp-modal-pin'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('fp-modal-submit'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('close_fiscal_period_v1',
        expect.objectContaining({
          p_period_id: 'p1',
          p_manager_pin: '123456',
          p_lock: true,
        }));
    });
  });
});
