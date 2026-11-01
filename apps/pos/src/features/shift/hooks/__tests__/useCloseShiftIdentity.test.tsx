import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), clear: vi.fn(), print: vi.fn(), remember: vi.fn(),
  auth: { user: { id: 'actor-a' }, sessionToken: 'session-token-a' },
  shift: { current: { id: 'shift-a' } } }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: vi.fn() } } }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mocks.auth } }));
vi.mock('@/stores/shiftStore', () => ({ useShiftStore: Object.assign(
  (selector: (state: { clear: typeof mocks.clear }) => unknown) => selector({ clear: mocks.clear }),
  { getState: () => mocks.shift }) }));
vi.mock('../../shiftClosePrinting', () => ({ printClosedShift: mocks.print, rememberClosedShift: mocks.remember }));
import { useCloseShift } from '../useCloseShift';
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.user = { id: 'actor-a' }; mocks.auth.sessionToken = 'session-token-a';
  mocks.shift.current = { id: 'shift-a' }; mocks.print.mockResolvedValue({ success: true });
});
describe('close shift identity', () => {
  it('does not clear the next cashier shift or queue its predecessor report under another operator', async () => {
    let finish!: (value: unknown) => void;
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useCloseShift(), { wrapper });
    await act(async () => {
      const pending = result.current.mutateAsync({ session_id: 'shift-a', counted_cash: 0 });
      await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
      mocks.auth.user = { id: 'actor-b' }; mocks.auth.sessionToken = 'session-token-b';
      mocks.shift.current = { id: 'shift-b' };
      finish({ data: { session_id: 'shift-a', status: 'closed', zreport_id: null }, error: null });
      await pending;
    });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.remember).toHaveBeenCalledWith('shift-a', 'actor-a');
    expect(mocks.print).not.toHaveBeenCalled();
    expect(mocks.shift.current.id).toBe('shift-b');
  });
  it('clears and prints the shift that was closed by the current operator', async () => {
    mocks.rpc.mockResolvedValue({ data: { session_id: 'shift-a', status: 'closed', zreport_id: null }, error: null });
    const { result } = renderHook(() => useCloseShift(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ session_id: 'shift-a', counted_cash: 0 }); });
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.remember).toHaveBeenCalledWith('shift-a', 'actor-a');
    expect(mocks.print).toHaveBeenCalledOnce();
  });
  it('does not clear a new shift opened by the same cashier while printing completes', async () => {
    let finish!: (value: { success: boolean }) => void;
    mocks.rpc.mockResolvedValue({ data: { session_id: 'shift-a', status: 'closed', zreport_id: null }, error: null });
    mocks.print.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useCloseShift(), { wrapper });
    await act(async () => {
      const pending = result.current.mutateAsync({ session_id: 'shift-a', counted_cash: 0 });
      await waitFor(() => expect(mocks.print).toHaveBeenCalled());
      mocks.shift.current = { id: 'shift-b' }; finish({ success: true }); await pending;
    });
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.shift.current.id).toBe('shift-b');
  });
});
