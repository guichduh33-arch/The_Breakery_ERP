// S76 — smoke du modal d'ajustement d'encours B2B (inventaire ⚫ #13).
//
// fireEvent, not userEvent — @testing-library/user-event is not a BO
// devDependency (cf. suppliers-crud.smoke.test.tsx: "no user-event in the
// BO toolchain"); adding it would be an out-of-scope lockfile change for
// this task. Coverage is equivalent for this controlled-input form.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdjustB2bBalanceModal } from '../components/AdjustB2bBalanceModal.js';

const rpcMock = vi.fn(async () => ({
  data: {
    customer_id: 'b1', balance_before: 250000, balance_after: 200000,
    delta: -50000, je_id: 'je-1', audit_log_id: 'al-1', idempotent_replay: false,
  },
  error: null,
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...(args as [])) },
}));

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdjustB2bBalanceModal customerId="b1" customerName="Hotel Kuta" open onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('AdjustB2bBalanceModal', () => {
  it('submits delta + reason + PIN to adjust_b2b_balance_v2 with an idempotency key', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/delta/i), { target: { value: '-50000' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'write-off drift' } });
    fireEvent.change(screen.getByLabelText(/manager pin/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /adjust balance/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const [fn, args] = rpcMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe('adjust_b2b_balance_v2');
    expect(args.p_customer_id).toBe('b1');
    expect(args.p_delta).toBe(-50000);
    expect(args.p_reason).toBe('write-off drift');
    expect(args.p_manager_pin).toBe('123456');
    expect(typeof args.p_idempotency_key).toBe('string');
  });

  it('disables submit while delta is 0 or reason/PIN empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /adjust balance/i })).toBeDisabled();
  });

  it('clears delta/reason/PIN when reopened after a cancel (open-keyed reset)', () => {
    // The modal stays mounted with only `open` toggling — typed values
    // (including the manager PIN) must not survive a Cancel/reopen cycle.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (open: boolean) => (
      <QueryClientProvider client={qc}>
        <AdjustB2bBalanceModal customerId="b1" customerName="Hotel Kuta" open={open} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(tree(true));
    fireEvent.change(screen.getByLabelText(/delta/i), { target: { value: '-50000' } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'write-off drift' } });
    fireEvent.change(screen.getByLabelText(/manager pin/i), { target: { value: '123456' } });
    expect(screen.getByLabelText(/manager pin/i)).toHaveValue('123456');

    rerender(tree(false)); // cancel/close — component stays mounted
    rerender(tree(true));  // reopen

    expect(screen.getByLabelText(/delta/i)).toHaveValue(null);
    expect(screen.getByLabelText(/reason/i)).toHaveValue('');
    expect(screen.getByLabelText(/manager pin/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /adjust balance/i })).toBeDisabled();
  });
});
