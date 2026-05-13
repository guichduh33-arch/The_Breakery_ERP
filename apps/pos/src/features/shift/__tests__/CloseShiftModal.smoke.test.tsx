// apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx
// Session 13 / Phase 3.C — RTL smoke for CloseShiftModal: renders the
// variance preview correctly and disables submit until counted_cash entered.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CloseShiftModal } from '../components/CloseShiftModal';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

const storeMock = { clear: vi.fn() };
vi.mock('@/stores/shiftStore', () => ({
  useShiftStore: <T,>(selector: (s: { clear: () => void }) => T) => selector(storeMock),
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('CloseShiftModal', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    storeMock.clear.mockReset();
  });

  it('shows expected cash and computes variance live', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={500_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        onClose={() => {}}
      />,
    ));
    expect(screen.getByText(/expected cash/i)).toBeInTheDocument();
    expect(screen.getByText(/counted cash/i)).toBeInTheDocument();
    expect(screen.getByTestId('variance-preview')).toBeInTheDocument();
    // Initial variance = 0 - 500_000 = -500_000 (large red).
    expect(screen.getByTestId('variance-preview').textContent).toMatch(/-500\.000/);
  });

  it('disables submit until amount entered', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        onClose={() => {}}
      />,
    ));
    const close = screen.getByRole('button', { name: /close shift/i });
    expect(close).toBeDisabled();
  });

  it('emits warning badge when variance breaches threshold', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        onClose={() => {}}
      />,
    ));
    expect(screen.getByTestId('variance-warning-badge')).toBeInTheDocument();
  });

  it('calls close_shift_v1 with parsed args', async () => {
    rpcMock.mockResolvedValue({
      data: {
        session_id: 's1', status: 'closed', opening_cash: 100_000, cash_sales: 0,
        cash_in_total: 0, cash_out_total: 0, counted_cash: 105_000,
        expected_cash: 100_000, variance: 5_000, journal_entry_id: 'je-1',
        idempotent_replay: false,
      },
      error: null,
    });
    const onClose = vi.fn();
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        onClose={onClose}
      />,
    ));
    // Simulate numpad typing 1 0 5 0 0 0 via button presses.
    for (const ch of '105000') {
      fireEvent.click(screen.getByRole('button', { name: ch }));
    }
    const btn = screen.getByRole('button', { name: /close shift/i });
    fireEvent.click(btn);
    // The mutation should fire (sync in microtask). Verify the rpc mock saw it.
    await Promise.resolve();
    await Promise.resolve();
    expect(rpcMock).toHaveBeenCalledWith('close_shift_v1', expect.objectContaining({
      p_session_id: 's1',
      p_counted_cash: 105_000,
    }));
  });
});
