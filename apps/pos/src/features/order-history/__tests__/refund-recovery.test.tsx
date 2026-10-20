import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { RefundOrderModal } from '../components/RefundOrderModal';
import { PendingRefundRecovery } from '../components/PendingRefundRecovery';
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
  RefundLineRow: ({ onChange }: { onChange: (qty: number) => void }) => <button onClick={() => onChange(1)}>Pick line</button>,
  RefundTenderSplitter: ({ onChange }: { onChange: (v: { method: 'cash'; amount: number }[]) => void }) => <button onClick={() => onChange([{ method: 'cash', amount: 50000 }])}>Split cash</button>,
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
function Modal({ full = false, onClose = vi.fn() }: { full?: boolean; onClose?: () => void }) {
  const mutation = useRefundOrder();
  return <RefundOrderModal open onClose={onClose} order={full ? { ...order, total_refunded: 50000, items: [{ ...order.items[0]!, qty_already_refunded: 1 }] } : order}
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
    fetch.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }));
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
  it.each([{}, { ...response, order_id: 'another-order' }, { ...response, total_refunded: NaN }, { ...response, error: 'invalid_envelope' }])('retains pending for invalid 2xx confirmation %#', async (data) => {
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
