import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefundOrderModalBo } from '../components/RefundOrderModalBo.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { financialStorageKey, readFinancialSlot } from '@/lib/pendingFinancialAttempts.js';
import { queryClient } from '@/lib/queryClient.js';

vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('@/lib/accessToken.js', () => ({ getAccessToken: () => Promise.resolve('jwt-never-persist') }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Order = React.ComponentProps<typeof RefundOrderModalBo>['order'];
const order: Order = {
  id: 'order-1', order_number: 'ORD-001', status: 'paid', order_type: 'dine_in', table_number: null,
  created_at: '2026-05-22T10:00:00Z', paid_at: '2026-05-22T10:05:00Z', sent_to_kitchen_at: null,
  customer_id: 'customer-1', customer_name: 'Acme', served_by: null, served_by_name: null,
  subtotal: 100, discount_amount: 0, tax_amount: 9, total: 100,
  items: [{ id: 'item-1', product_id: 'product-1', name_snapshot: 'Latte', quantity: 1, unit_price: 100,
    line_total: 100, modifiers: null, is_cancelled: false, kitchen_status: null, qty_already_refunded: 0 }],
  payments: [{ id: 'pay-1', method: 'card', amount: 100, cash_received: null, change_given: null,
    paid_at: '2026-05-22T10:05:00Z', reference: null }],
  refunds: [], promotions: [], refunded_by_method: {}, total_refunded: 0,
};
const success = { refund_id: 'refund-1', refund_number: 'REF-001', order_id: 'order-1', total_refunded: 100, tax_refunded: 9 };
const scope = { environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'profile-a', operation: 'refund' as const, target: 'order-1' };
const backend = vi.fn<typeof fetch>();
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function setup(value = order) {
  const close = vi.fn();
  const client = queryClient;
  client.clear();
  const view = render(<QueryClientProvider client={client}><RefundOrderModalBo open order={value} onClose={close} /></QueryClientProvider>);
  return { ...view, close, client };
}
function draft() {
  fireEvent.click(screen.getByLabelText('Increase Latte'));
  fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'Customer returned item' } });
  fireEvent.change(screen.getByTestId('refund-pin'), { target: { value: '123456' } });
}
async function submit() { fireEvent.click(screen.getByTestId('refund-submit')); await waitFor(() => expect(backend).toHaveBeenCalled()); }

describe('refund durable recovery with real hook and modal', () => {
  beforeEach(() => { vi.restoreAllMocks(); installFinancialBrowser(); resetFinancialSession(); backend.mockReset(); vi.stubGlobal('fetch', backend); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

  it('recovers a committed full refund after unmount/reload and reuses the exact key and payload with a newly entered PIN', async () => {
    const ledger = new Map<string, unknown>();
    backend.mockImplementation((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      const key = headers['x-idempotency-key']!;
      expect(readFinancialSlot(scope)?.status).toBe('pending');
      if (!ledger.has(key)) { ledger.set(key, JSON.parse(init?.body as string)); return Promise.reject(new TypeError('Response lost')); }
      return Promise.resolve(reply({ ...success, idempotent_replay: true }));
    });
    const first = setup(); draft(); await submit();
    expect(await screen.findByRole('status')).toHaveTextContent('unconfirmed');
    expect(screen.getByTestId('refund-reason')).toBeDisabled();
    const raw = localStorage.getItem(financialStorageKey(scope))!;
    expect(raw).not.toMatch(/123456|jwt-never-persist|session-a-secret|Authorization|managerPin|headers/);
    first.unmount();
    const next = setup({ ...order, total_refunded: 100, refunded_by_method: { card: 100 },
      items: order.items.map((item) => ({ ...item, qty_already_refunded: 1 })) });
    expect(screen.getByTestId('refund-pin')).toHaveValue('');
    expect(screen.getByTestId('refund-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('refund-pin'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check pending refund' }));
    await waitFor(() => expect(next.close).toHaveBeenCalledTimes(1));
    const [, firstInit] = backend.mock.calls[0]!;
    const [, retryInit] = backend.mock.calls[1]!;
    expect(retryInit?.body).toEqual(firstInit?.body);
    expect((retryInit?.headers as Record<string, string>)['x-idempotency-key']).toBe((firstInit?.headers as Record<string, string>)['x-idempotency-key']);
    expect((retryInit?.headers as Record<string, string>)['x-manager-pin']).toBe('654321');
    expect(ledger.size).toBe(1);
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });

  it('retains the unknown attempt after a later wrong PIN and treats malformed 2xx as unknown', async () => {
    backend.mockResolvedValueOnce(reply({ refund_number: 'incomplete' })).mockResolvedValueOnce(reply({ error: 'wrong_pin' }, 401));
    setup(); draft(); await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid');
    const pending = readFinancialSlot(scope);
    expect(screen.getByTestId('refund-pin')).toHaveValue('');
    expect(screen.getByTestId('refund-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('refund-submit'));
    expect(backend).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByTestId('refund-pin'), { target: { value: '654321' } });
    expect(screen.getByTestId('refund-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('refund-submit'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect manager PIN'));
    expect(screen.getByTestId('refund-pin')).toHaveValue('');
    expect(screen.getByTestId('refund-submit')).toBeDisabled();
    expect((backend.mock.calls[1]?.[1]?.headers as Record<string, string>)['x-manager-pin']).toBe('654321');
    expect(readFinancialSlot(scope)).toEqual(pending);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('releases a definitive first refusal and uses a new key only after confirmed completion', async () => {
    backend.mockResolvedValueOnce(reply({ error: 'wrong_pin' }, 401)).mockResolvedValue(reply(success));
    const first = setup(); draft(); await submit();
    await waitFor(() => expect(readFinancialSlot(scope)?.status).toBe('resolved'));
    fireEvent.change(screen.getByTestId('refund-pin'), { target: { value: '654321' } });
    fireEvent.click(screen.getByTestId('refund-submit'));
    await waitFor(() => expect(first.close).toHaveBeenCalled());
    first.unmount();
    setup(); draft(); fireEvent.click(screen.getByTestId('refund-submit'));
    await waitFor(() => expect(backend).toHaveBeenCalledTimes(3));
    const keys = backend.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['x-idempotency-key']);
    expect(new Set(keys).size).toBe(3);
  });

  it('does not close, toast, invalidate or clear the new operator UI when an old response arrives', async () => {
    const response = deferred<Response>(); backend.mockReturnValue(response.promise);
    const view = setup(); draft(); await submit();
    act(() => financialTestAuth.setState({ user: { ...financialTestAuth.getState().user, id: 'profile-b' }, sessionToken: 'session-b' }));
    fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'Operator B draft' } });
    view.client.setQueryData(['order-detail', order.id], { owner: 'B' });
    await act(async () => { response.resolve(reply(success)); await response.promise; });
    await waitFor(() => expect(readFinancialSlot(scope)?.status).toBe('resolved'));
    expect(view.close).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId('refund-reason')).toHaveValue('Operator B draft');
    expect(view.client.getQueryState(['order-detail', order.id])?.isInvalidated).toBe(false);
  });

  it('sends nothing when local storage is not writable', async () => {
    setup(); draft();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    fireEvent.click(screen.getByTestId('refund-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('storage');
    expect(backend).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('sends nothing without native locks or with a corrupted durable record', async () => {
    const first = setup(); draft();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    fireEvent.click(screen.getByTestId('refund-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('locking is unavailable');
    expect(backend).not.toHaveBeenCalled(); first.unmount();
    installFinancialBrowser();
    localStorage.setItem(financialStorageKey(scope), '{invalid');
    setup(); draft();
    expect(screen.getByTestId('refund-submit')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('storage');
    expect(backend).not.toHaveBeenCalled();
  });

  it('suppresses old errors including the global mutation-cache toast after A changes to B', async () => {
    const response = deferred<Response>(); backend.mockReturnValue(response.promise);
    setup(); draft(); await submit();
    act(() => financialTestAuth.setState({ user: { ...financialTestAuth.getState().user, id: 'profile-b' }, sessionToken: 'session-b' }));
    fireEvent.change(screen.getByTestId('refund-reason'), { target: { value: 'B keeps this draft' } });
    await act(async () => { response.reject(new TypeError('Connection lost for operator A')); await response.promise.catch(() => undefined); });
    expect(screen.queryByTestId('refund-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('refund-reason')).toHaveValue('B keeps this draft');
    expect(toast.error).not.toHaveBeenCalled();
    expect(readFinancialSlot(scope)?.status).toBe('pending');
  });
});
