import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useReconnectInvalidate } from '../useReconnectInvalidate';

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useReconnectInvalidate (LOT 5 reconnect safety net)', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
  });

  it('invalidates the passed query keys when the browser fires `online`', () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useReconnectInvalidate([['held-orders']]), {
      wrapper: wrapper(qc),
    });

    // No invalidation until the network actually comes back.
    expect(spy).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['held-orders'] });
  });

  it('invalidates every key when several are passed', () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(
      () => useReconnectInvalidate([['a'], ['b', 1]]),
      { wrapper: wrapper(qc) },
    );

    window.dispatchEvent(new Event('online'));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['a'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['b', 1] });
  });

  it('removes the listener on unmount (no invalidation after teardown)', () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { unmount } = renderHook(
      () => useReconnectInvalidate([['x']]),
      { wrapper: wrapper(qc) },
    );

    unmount();
    window.dispatchEvent(new Event('online'));

    expect(spy).not.toHaveBeenCalled();
  });

  it('is a no-op when passed an empty key list', () => {
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useReconnectInvalidate([]), { wrapper: wrapper(qc) });

    window.dispatchEvent(new Event('online'));

    expect(spy).not.toHaveBeenCalled();
  });
});
