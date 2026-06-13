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
const invokeMock = vi.fn().mockResolvedValue({ data: { signed_url: 'https://example.test/z' }, error: null });
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
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

  it('blocks closing on above-threshold variance without a note (P1-2)', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={570_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        onClose={vi.fn()}
      />,
    ));
    // Compte 500 000 → variance -70 000 > seuil abs 50 000.
    for (const ch of '500000') {
      fireEvent.click(screen.getByRole('button', { name: ch }));
    }
    expect(screen.getByRole('button', { name: /close shift/i })).toBeDisabled();
    expect(screen.getByText(/note .*(required|obligatoire)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'till miscount, recount pending' },
    });
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
  });

  it('does not require a note when variance is within threshold', () => {
    render(withQuery(
      <CloseShiftModal
        open={true}
        sessionId="s1"
        expectedCash={100_000}
        thresholdAbs={50_000}
        thresholdPct={0.005}
        onClose={vi.fn()}
      />,
    ));
    // Compte 100 300 → variance +300 : sous le seuil abs (50 000) ET sous le
    // seuil pct (0,3 % < 0,5 %).
    for (const ch of '100300') {
      fireEvent.click(screen.getByRole('button', { name: ch }));
    }
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
    expect(screen.queryByText(/note .*(required|obligatoire)/i)).not.toBeInTheDocument();
  });

  it('calls close_shift_v2 with parsed args and chains generate-zreport-pdf EF', async () => {
    rpcMock.mockResolvedValue({
      data: {
        session_id: 's1', status: 'closed', opening_cash: 100_000, cash_sales: 0,
        cash_in_total: 0, cash_out_total: 0, counted_cash: 105_000,
        expected_cash: 100_000, variance: 5_000, journal_entry_id: 'je-1',
        zreport_id: 'zr-1', idempotent_replay: false,
      },
      error: null,
    });
    invokeMock.mockClear();
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
    for (const ch of '105000') {
      fireEvent.click(screen.getByRole('button', { name: ch }));
    }
    // Variance +5 000 = 5 % > seuil pct 0,5 % → une note est requise (P1-2).
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: 'recount confirmed by manager' },
    });
    const btn = screen.getByRole('button', { name: /close shift/i });
    fireEvent.click(btn);
    // Flush microtasks: 1st for the RPC await, 2nd for the EF invoke chain, 3rd for the onSuccess.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(rpcMock).toHaveBeenCalledWith('close_shift_v2', expect.objectContaining({
      p_session_id: 's1',
      p_counted_cash: 105_000,
    }));
    expect(invokeMock).toHaveBeenCalledWith('generate-zreport-pdf', expect.objectContaining({
      body: { zreport_id: 'zr-1' },
      headers: expect.objectContaining({ 'x-idempotency-key': expect.any(String) }),
    }));
  });

  it('does not throw when EF generate-zreport-pdf fails (non-blocking)', async () => {
    rpcMock.mockResolvedValue({
      data: {
        session_id: 's1', status: 'closed', opening_cash: 100_000, cash_sales: 0,
        cash_in_total: 0, cash_out_total: 0, counted_cash: 100_000,
        expected_cash: 100_000, variance: 0, journal_entry_id: 'je-2',
        zreport_id: 'zr-2', idempotent_replay: false,
      },
      error: null,
    });
    invokeMock.mockRejectedValueOnce(new Error('network failure'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    for (const ch of '100000') {
      fireEvent.click(screen.getByRole('button', { name: ch }));
    }
    fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
    // Wait for the mutation chain to complete (RPC → EF.invoke → catch → return).
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());
    // Shift still closed (RPC succeeded), EF failure was swallowed (no throw).
    expect(rpcMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
