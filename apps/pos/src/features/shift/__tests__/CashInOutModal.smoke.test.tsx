// apps/pos/src/features/shift/__tests__/CashInOutModal.smoke.test.tsx
// Session 60 (12 D1.1) — reason_code + idempotency-key smoke for the
// previously-orphaned CashInOutModal.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CashInOutModal } from '../components/CashInOutModal';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]): unknown => rpcMock(...args) },
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function enterAmount(amount: string): void {
  for (const ch of amount) {
    fireEvent.click(screen.getByRole('button', { name: ch }));
  }
}

function successResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      movement_id: 'm1', session_id: 's1', cash_in_total: 100, cash_out_total: 0,
      je_id: null, idempotent_replay: false, ...overrides,
    },
    error: null,
  };
}

describe('CashInOutModal', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  // T1
  it('renders the reason_code select with 4 options, default misc', () => {
    render(withQuery(
      <CashInOutModal open sessionId="s1" direction="in" onClose={vi.fn()} />,
    ));
    const select = screen.getByTestId<HTMLSelectElement>('cash-reason-code');
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('misc');
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['misc', 'apport_owner', 'bank_transfer', 'replenishment']);
  });

  // T2
  it('submits with apport_owner reason_code and an idempotency key', async () => {
    rpcMock.mockResolvedValue(successResult());
    render(withQuery(
      <CashInOutModal open sessionId="s1" direction="in" onClose={vi.fn()} />,
    ));
    fireEvent.change(screen.getByTestId('cash-reason-code'), { target: { value: 'apport_owner' } });
    enterAmount('100000');
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'owner top-up' } });
    fireEvent.click(screen.getByRole('button', { name: /record cash in/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith('record_cash_movement_v2', expect.objectContaining({
      p_reason_code: 'apport_owner',
      p_idempotency_key: expect.any(String) as unknown,
    }));
  });

  // T3
  it('submits reason_code misc when the select is left untouched', async () => {
    rpcMock.mockResolvedValue(successResult());
    render(withQuery(
      <CashInOutModal open sessionId="s1" direction="out" onClose={vi.fn()} />,
    ));
    enterAmount('50000');
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'petty cash' } });
    fireEvent.click(screen.getByRole('button', { name: /record cash out/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith('record_cash_movement_v2', expect.objectContaining({
      p_reason_code: 'misc',
    }));
  });

  // T4
  it('keeps the idempotency key stable across a retry, then rotates it after success', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    rpcMock.mockResolvedValueOnce(successResult());
    render(withQuery(
      <CashInOutModal open sessionId="s1" direction="in" onClose={vi.fn()} />,
    ));
    enterAmount('100000');
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'float top-up' } });
    const submitBtn = screen.getByRole('button', { name: /record cash in/i });

    fireEvent.click(submitBtn);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const firstKey = (rpcMock.mock.calls[0]?.[1] as { p_idempotency_key: string }).p_idempotency_key;

    // Retry the same failed submission — key must be STABLE (no rotation on error).
    fireEvent.click(submitBtn);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(2));
    const secondKey = (rpcMock.mock.calls[1]?.[1] as { p_idempotency_key: string }).p_idempotency_key;
    expect(secondKey).toBe(firstKey);

    // The retry succeeded → amount/reason reset; re-enter and submit again.
    // The key must now be ROTATED (different from the successful call's key).
    enterAmount('200000');
    fireEvent.change(screen.getByLabelText(/^reason$/i), { target: { value: 'second float top-up' } });
    rpcMock.mockResolvedValueOnce(successResult());
    fireEvent.click(screen.getByRole('button', { name: /record cash in/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(3));
    const thirdKey = (rpcMock.mock.calls[2]?.[1] as { p_idempotency_key: string }).p_idempotency_key;
    expect(thirdKey).not.toBe(secondKey);
  });
});
