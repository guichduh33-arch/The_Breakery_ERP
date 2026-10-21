import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useRefundOrder } from '../hooks/useRefundOrder';

const token = vi.hoisted(() => vi.fn(() => Promise.resolve('tok')));
vi.mock('@/lib/accessToken', () => ({ getAccessToken: token }));
const args = { orderId: 'order-1', lines: [{ order_item_id: 'line', qty: 1 }], tenders: [{ method: 'cash' as const, amount: 50000 }],
  reason: 'Customer return', managerPin: '987654', idempotencyKey: '11111111-2222-4333-8444-555555555555' };
const response = { refund_id: 'rf-1', refund_number: 'RF-001', order_id: 'order-1', order_number: 'P-1', total_refunded: 50000,
  tax_refunded: 0, tenders: [{ method: 'cash', amount: 50000 }], pts_deducted: 0, manager: { id: 'manager', full_name: 'Manager', role_code: 'MANAGER' } };
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  token.mockReset().mockResolvedValue('tok');
  useAuthStore.setState({ user: { id: 'cashier', full_name: 'Cashier', role_code: 'MANAGER', employee_code: 'C' }, sessionToken: 'tok',
    isAuthenticated: true, isLoading: false, isLocked: false, permissions: ['orders.refund'] });
});
afterEach(() => vi.restoreAllMocks());
describe('refund transport boundary', () => {
  it('sends the manager PIN only in its header and forwards the durable attempt key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    const hook = renderHook(useRefundOrder, { wrapper });
    await act(async () => { await hook.result.current.mutateAsync(args); });
    const [url, init] = fetch.mock.calls[0]!;
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    expect(address).toContain('/functions/v1/refund-order');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-manager-pin')).toBe(args.managerPin);
    expect(headers.get('x-idempotency-key')).toBe(args.idempotencyKey);
    expect(headers.get('Authorization')).toBe('Bearer tok');
    expect(JSON.parse(init?.body as string)).toEqual({ order_id: args.orderId, lines: args.lines, tenders: args.tenders, reason: args.reason });
  });
  it('does not dispatch if re-PIN changes the session while resolving the bearer', async () => {
    let finish!: (value: string) => void;
    token.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const fetch = vi.spyOn(globalThis, 'fetch'); const hook = renderHook(useRefundOrder, { wrapper });
    await act(async () => {
      const operation = hook.result.current.mutateAsync(args);
      await Promise.resolve();
      useAuthStore.setState({ sessionToken: 'new-token' }); finish('tok');
      await expect(operation).rejects.toThrow('session changed');
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
