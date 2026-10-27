import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { RefundOrderModal } from '../components/RefundOrderModal';
import { PendingRefundRecovery } from '../components/PendingRefundRecovery';
import { OrderDetailDrawer } from '../components/OrderDetailDrawer';
import { useRefundOrder } from '../hooks/useRefundOrder';
import { readFinancialSlot, runFinancialAttempt } from '../hooks/refundRecovery';
import type { OrderDetail } from '../hooks/useOrderDetail';
import { financialStorageKey } from '@breakery/utils';
import type * as UI from '@breakery/ui';

const token = vi.hoisted(() => vi.fn(() => Promise.resolve('token-a')));
vi.mock('@/lib/accessToken', () => ({ getAccessToken: token }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@breakery/ui', async (original) => ({
  ...await original<typeof UI>(),
  FullScreenModal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  NumpadPin: ({ onSubmit, isLoading, error }: { onSubmit: (pin: string) => void; isLoading: boolean; error?: string }) => <>{error && <p role="alert">{error}</p>}<button disabled={isLoading} onClick={() => onSubmit('654321')}>Verify PIN</button></>,
  RefundLineRow: ({ onChange, item }: { onChange: (qty: number) => void; item: { quantity: number; qty_already_refunded: number } }) => <button onClick={() => onChange(item.quantity - item.qty_already_refunded)}>Pick line</button>,
  RefundTenderSplitter: ({ onChange, refundTotal }: { onChange: (v: { method: 'cash'; amount: number }[]) => void; refundTotal: number }) => <button onClick={() => onChange([{ method: 'cash', amount: refundTotal }])}>Split cash</button>,
}));
const scope = { environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'cashier', operation: 'refund' as const, target: 'order-1' };
const payload = { orderId: 'order-1', lines: [{ order_item_id: 'line-1', qty: 1 }], tenders: [{ method: 'cash' as const, amount: 50000 }], reason: 'Customer return' };
const order: OrderDetail = { id: 'order-1', order_number: 'P-1', status: 'paid', total: 50000, tax_amount: 0,
  customer_id: null, table_number: null, paid_at: null, voided_at: null, void_reason: null,
  items: [{ id: 'line-1', product_id: 'product', name_snapshot: 'Coffee', quantity: 1, line_total: 50000, is_cancelled: false, qty_already_refunded: 0 }],
  payments: [{ id: 'payment', method: 'cash', amount: 50000, reference: null }], refunded_by_method: {}, total_refunded: 0 };
const response = { refund_id: 'refund-1', refund_number: 'RF-1', order_id: 'order-1', order_number: 'P-1', total_refunded: 50000,
  tax_refunded: 0, tenders: [{ method: 'cash', amount: 50000 }], pts_deducted: 0, manager: { id: 'manager', full_name: 'Manager', role_code: 'MANAGER' } };
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{children}</QueryClientProvider>;
}
function Modal({ full = false, onClose = vi.fn(), value = order, open = true }: { full?: boolean; onClose?: () => void; value?: OrderDetail; open?: boolean }) {
  const mutation = useRefundOrder();
  return <RefundOrderModal open={open} onClose={onClose} order={full ? { ...value, total_refunded: 50000, items: [{ ...value.items[0]!, qty_already_refunded: 1 }] } : value}
    onSubmit={async (args) => { await mutation.mutateAsync(args); }} />;
}
function installLocks() {
  const held = new Set<string>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: LockOptions, cb: (lock: Lock | null) => Promise<unknown>) => {
    if (held.has(name)) return cb(null); held.add(name);
    try { return await cb({ name, mode: 'exclusive' }); } finally { held.delete(name); }
  } } });
}
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); installLocks(); token.mockResolvedValue('token-a');
  useAuthStore.setState({ user: { id: 'cashier', full_name: 'Cashier', employee_code: 'C', role_code: 'MANAGER' }, sessionToken: 'token-a',
    isAuthenticated: true, isLoading: false, isLocked: false, permissions: ['orders.refund'] });
});
describe('POS refund durable recovery', () => {
  it('ignores an old lock failure after closing and reopening before the request was sent', async () => {
    let refuse!: (reason?: unknown) => void;
    const request = vi.fn(() => new Promise<never>((_resolve, reject) => { refuse = reject; }));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    const fetch = vi.spyOn(globalThis, 'fetch');
    const mounted = render(<Modal />, { wrapper });
    fireEvent.click(screen.getByText('Pick line')); fireEvent.click(screen.getByText('Split cash'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: payload.reason } });
    fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(request).toHaveBeenCalled());
    mounted.rerender(<Modal open={false} />);
    mounted.rerender(<Modal />);
    await act(async () => { refuse(new Error('Old lock failed')); await Promise.resolve(); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(readFinancialSlot(scope)).toBeNull();
  });
  it('keeps remaining points accessible after the monetary balance has been refunded', () => {
    render(<OrderDetailDrawer order={{ ...order, total_refunded: order.total, loyalty_points_redeemed: 100 }}
      onRefundClick={vi.fn()} onVoidClick={vi.fn()} />, { wrapper });
    expect(screen.getByRole('button', { name: 'Refund lines' })).toBeEnabled();
  });
  it('records a final points-only return with no monetary tender', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...response, total_refunded: 0, tax_refunded: 0, tenders: [], pts_restored: 1,
    }), { status: 200 }));
    const close = vi.fn();
    render(<Modal onClose={close} value={{ ...order, total: 9000, total_refunded: 9000,
      customer_id: 'customer', loyalty_points_redeemed: 100,
      items: [{ ...order.items[0]!, line_total: 10000, qty_already_refunded: 0.999 }] }} />, { wrapper });
    fireEvent.click(screen.getByText('Pick line'));
    expect(screen.getByText(/No money remains to refund/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: payload.reason } });
    fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect((JSON.parse(fetch.mock.calls[0]![1]!.body as string) as { tenders: unknown }).tenders).toEqual([]);
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });

  it.each(['modal', 'recovery'])('ignores a late refusal after the operator changes in %s', async (surface) => {
    if (surface === 'recovery') await expect(runFinancialAttempt({ scope, payload, expectedRevision: null,
      current: () => true, send: () => Promise.reject(new Error('Response lost')) })).rejects.toThrow('Response lost');
    let refuse!: (value: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => { refuse = resolve; }));
    render(surface === 'modal' ? <Modal /> : <PendingRefundRecovery onConfirmed={vi.fn()} />, { wrapper });
    if (surface === 'modal') {
      fireEvent.click(screen.getByText('Pick line')); fireEvent.click(screen.getByText('Split cash'));
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: payload.reason } });
    } else fireEvent.click(screen.getByRole('button', { name: /Resume pending refund/ }));
    fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => useAuthStore.setState({ sessionToken: 'operator-b-session' }));
    await act(async () => { refuse(new Response(JSON.stringify({ error: 'loyalty_points_unavailable' }), { status: 422 })); await Promise.resolve(); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(readFinancialSlot(scope)?.status).toBe(surface === 'recovery' ? 'pending' : 'resolved');
  });
  it.each([false, true])('explains a points refusal and preserves a previously uncertain attempt: %s', async (uncertain) => {
    if (uncertain) await expect(runFinancialAttempt({ scope, payload, expectedRevision: null, current: () => true,
      send: () => Promise.reject(new Error('Response lost')) })).rejects.toThrow('Response lost');
    const saved = readFinancialSlot(scope);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ error: 'loyalty_points_unavailable' }), { status: 422 }));
    const close = vi.fn();
    render(<Modal onClose={close} />, { wrapper });
    if (!uncertain) {
      fireEvent.click(screen.getByText('Pick line')); fireEvent.click(screen.getByText('Split cash'));
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: payload.reason } });
    }
    fireEvent.click(screen.getByText('Verify PIN'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough loyalty points');
    await waitFor(() => expect(readFinancialSlot(scope)?.status).toBe(uncertain ? 'pending' : 'resolved'));
    if (uncertain) {
      expect(readFinancialSlot(scope)).toEqual(saved);
      expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('x-idempotency-key')).toBe(saved?.status === 'pending' ? saved.idempotencyKey : undefined);
    }
    expect(close).not.toHaveBeenCalled();
  });
  it('preserves the net monetary payload for a sale with redeemed points', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const loyaltyOrder = { ...order, total: 45_000, customer_id: 'customer', loyalty_points_redeemed: 500 };
    render(<RefundOrderModal open onClose={vi.fn()} order={loyaltyOrder} onSubmit={submit} />, { wrapper });
    fireEvent.click(screen.getByText('Pick line'));
    expect(screen.getByRole('status')).toHaveTextContent('Points to restore: 500');
    fireEvent.click(screen.getByText('Split cash'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Customer return' } });
    fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ order_item_id: 'line-1', qty: 1 }], tenders: [{ method: 'cash', amount: 45_000 }],
    })));
  });
  it('keeps the original body/key through close, remount, full refund and re-PIN', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ACK lost'));
    const mounted = render(<Modal />, { wrapper });
    fireEvent.click(screen.getByText('Pick line')); fireEvent.click(screen.getByText('Split cash'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: payload.reason } });
    fireEvent.click(screen.getByText('Verify PIN'));
    await screen.findByRole('alert');
    const saved = readFinancialSlot(scope)!;
    expect(saved.status).toBe('pending');
    expect(localStorage.getItem(financialStorageKey(scope))).not.toMatch(/654321|token-a|token-b/);
    expect(screen.getByLabelText('Reason')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Close')); mounted.unmount();
    useAuthStore.setState({ sessionToken: 'token-b' }); token.mockResolvedValue('token-b');
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...response, idempotent_replay: true }), { status: 200 }));
    render(<Modal full />, { wrapper });
    fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(readFinancialSlot(scope)?.status).toBe('resolved'));
    const first = fetch.mock.calls[0]![1]!; const second = fetch.mock.calls[1]![1]!;
    expect(second.body).toBe(first.body);
    expect(new Headers(second.headers).get('x-idempotency-key')).toBe(new Headers(first.headers).get('x-idempotency-key'));
    expect(new Headers(second.headers).get('Authorization')).toBe('Bearer token-b');
    expect(localStorage.getItem(financialStorageKey(scope))).not.toMatch(/654321|token-a|token-b/);
  });
  it('resumes without a server detail or order in the displayed shift', async () => {
    await expect(runFinancialAttempt({ scope, payload, expectedRevision: null, current: () => true, send: () => Promise.reject(new Error('lost')) })).rejects.toThrow('lost');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    const confirmed = vi.fn(); render(<PendingRefundRecovery onConfirmed={confirmed} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Resume pending refund/ }));
    fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(confirmed).toHaveBeenCalledWith(response));
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });
  it.each([{}, { ...response, order_number: undefined }, { ...response, order_number: null }, { ...response, order_id: 'another-order' }, { ...response, total_refunded: NaN }, { ...response, error: 'invalid_envelope' }])('retains pending for invalid 2xx confirmation %#', async (data) => {
    await expect(runFinancialAttempt({ scope, payload, expectedRevision: null, current: () => true, send: () => Promise.reject(new Error('lost')) })).rejects.toThrow('lost');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    render(<PendingRefundRecovery onConfirmed={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Resume pending refund/ })); fireEvent.click(screen.getByText('Verify PIN'));
    await screen.findByRole('alert'); expect(readFinancialSlot(scope)?.status).toBe('pending');
  });
  it.each(['locking', 'storage'])('sends nothing when %s is unavailable', async (fault) => {
    if (fault === 'locking') Object.defineProperty(navigator, 'locks', { value: undefined });
    else vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const fetch = vi.spyOn(globalThis, 'fetch');
    render(<Modal />, { wrapper }); fireEvent.click(screen.getByText('Pick line')); fireEvent.click(screen.getByText('Split cash'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: payload.reason } }); fireEvent.click(screen.getByText('Verify PIN'));
    await screen.findByRole('alert'); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not present a stale response after the operator changes', async () => {
    let resolve!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((done) => { resolve = done; }));
    await expect(runFinancialAttempt({ scope, payload, expectedRevision: null, current: () => true, send: () => Promise.reject(new Error('lost')) })).rejects.toThrow('lost');
    const confirmed = vi.fn(); render(<PendingRefundRecovery onConfirmed={confirmed} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Resume pending refund/ })); fireEvent.click(screen.getByText('Verify PIN'));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    act(() => useAuthStore.setState({ sessionToken: 'new-session' }));
    await act(async () => { resolve(new Response(JSON.stringify(response), { status: 200 })); await Promise.resolve(); });
    expect(confirmed).not.toHaveBeenCalled(); expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });
});
