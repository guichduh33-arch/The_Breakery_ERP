import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
import { useShiftCloseSummary } from '../useShiftCloseSummary';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
describe('useShiftCloseSummary', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the server preview including receipts and reversals from their receiving shifts', async () => {
    const summary = { expectedCash: 340000, thresholdAbs: 50000, thresholdPct: 0.005,
      pinThresholdAbs: 200000, pinThresholdPct: 0.02 };
    mocks.rpc.mockResolvedValue({ data: summary, error: null });
    const { result } = renderHook(() => useShiftCloseSummary('session-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('get_shift_close_preview_v1', { p_session_id: 'session-1' });
    expect(result.current.data).toEqual(summary);
  });
  it('fails closed when the server preview is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'no_open_shift' } });
    const { result } = renderHook(() => useShiftCloseSummary('session-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('no_open_shift');
  });
  it('refuses an invalid server response', async () => {
    mocks.rpc.mockResolvedValue({ data: { expectedCash: '340000' }, error: null });
    const { result } = renderHook(() => useShiftCloseSummary('session-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Invalid shift summary');
  });
  it('does not fetch without a session', () => {
    const { result } = renderHook(() => useShiftCloseSummary(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
