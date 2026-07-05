// apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx
// Session 13 / Phase 3.C — RTL smoke for CloseShiftModal.
// LOT 4 (audit 2026-06-25) — blind cash count: expected & variance are hidden
// during entry and only revealed after the count is confirmed.

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

/** Type the digits on the numpad then commit the blind count → review step. */
function countAndConfirm(amount: string): void {
  for (const ch of amount) {
    fireEvent.click(screen.getByRole('button', { name: ch }));
  }
  fireEvent.click(screen.getByRole('button', { name: /confirm count/i }));
}

describe('CloseShiftModal', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    storeMock.clear.mockReset();
  });

  it('hides expected cash and variance during the blind count (LOT 4)', () => {
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
    // Blind step: counted cash field shows, but NOT expected/variance.
    expect(screen.getByText(/counted cash/i)).toBeInTheDocument();
    expect(screen.queryByText(/expected cash/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-warning-badge')).not.toBeInTheDocument();
    // The expected figure (500.000) must not leak anywhere on screen.
    expect(screen.queryByText(/500\.000/)).not.toBeInTheDocument();
  });

  it('reveals expected cash and variance only after confirming the count', () => {
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
    countAndConfirm('500000');
    expect(screen.getByText(/expected cash/i)).toBeInTheDocument();
    expect(screen.getByTestId('variance-preview')).toBeInTheDocument();
    // Counted 500.000 vs expected 500.000 → variance 0.
    expect(screen.getByTestId('variance-preview').textContent).toMatch(/^0$/);
  });

  it('disables confirm until amount entered', () => {
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
    expect(screen.getByRole('button', { name: /confirm count/i })).toBeDisabled();
  });

  it('emits warning badge when variance breaches threshold (after reveal)', () => {
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
    countAndConfirm('0');
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
    countAndConfirm('500000');
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
    countAndConfirm('100300');
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
    expect(screen.queryByText(/note .*(required|obligatoire)/i)).not.toBeInTheDocument();
  });

  it('Back returns to the blind count and re-hides expected/variance', () => {
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
    countAndConfirm('100000');
    expect(screen.getByText(/expected cash/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.queryByText(/expected cash/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('variance-preview')).not.toBeInTheDocument();
  });

  it('calls close_shift_v3 with parsed args and chains generate-zreport-pdf EF', async () => {
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
    countAndConfirm('105000');
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
    expect(rpcMock).toHaveBeenCalledWith('close_shift_v3', expect.objectContaining({
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
    countAndConfirm('100000');
    fireEvent.click(screen.getByRole('button', { name: /close shift/i }));
    // Wait for the mutation chain to complete (RPC → EF.invoke → catch → return).
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());
    // Shift still closed (RPC succeeded), EF failure was swallowed (no throw).
    expect(rpcMock).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
