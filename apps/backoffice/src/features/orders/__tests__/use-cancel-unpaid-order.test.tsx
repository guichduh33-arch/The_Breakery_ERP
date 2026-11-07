import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCancelUnpaidOrder, type CancelUnpaidAttempt } from '../hooks/useCancelUnpaidOrder.js';

vi.mock('@/lib/supabase.js', () => ({ supabase: {} }));
vi.mock('@/lib/accessToken.js', () => ({ getAccessToken: () => Promise.resolve('pin-session-token') }));

const attempt = {
  snapshot: { id: 'order-1', updated_at: '2026-11-03T00:00:00Z', order_items: [{ id: 'line-1', is_locked: true }] },
  losses: [{ id: 'line-1', waste_qty: 0 }], reason: 'Customer left', idempotencyKey: 'same-attempt',
} as CancelUnpaidAttempt;
const fetchMock = vi.fn();

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { ...renderHook(() => useCancelUnpaidOrder(), { wrapper: Wrapper }), invalidate };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ order_id: 'order-1', status: 'voided' }) });
});

describe('Back-office unpaid cancellation transport', () => {
  it('sends the full snapshot, explicit waste and stable key with the PIN in its header', async () => {
    const { result, invalidate } = setup();
    await act(async () => { await result.current.mutateAsync({ attempt, managerPin: '123456' }); });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/functions\/v1\/cancel-unpaid-order$/);
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer pin-session-token', 'x-manager-pin': '123456', 'x-idempotency-key': 'same-attempt',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      order_id: attempt.snapshot.id, expected_updated_at: attempt.snapshot.updated_at,
      expected_items: attempt.snapshot.order_items, losses: attempt.losses, reason: attempt.reason,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order-detail', 'order-1'] });
  });

  it('keeps the same key on retry and refreshes data after an unconfirmed response', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { result, invalidate } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ attempt, managerPin: '123456' })).rejects.toThrow('network');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order-detail', 'order-1'] });
    await act(async () => { await result.current.mutateAsync({ attempt, managerPin: '123456' }); });
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).headers)).toEqual([
      expect.objectContaining({ 'x-idempotency-key': 'same-attempt' }),
      expect.objectContaining({ 'x-idempotency-key': 'same-attempt' }),
    ]);
  });

  it('requires confirmation for the exact order before reporting success', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ order_id: 'another-order', status: 'voided' }) });
    const { result } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ attempt, managerPin: '123456' })).rejects.toThrow('could not be confirmed');
    });
  });
});
