import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConvertLoyaltyModal } from '@/features/customers/components/ConvertLoyaltyModal.js';
import { LoyaltyAdjustModal } from '../components/LoyaltyAdjustModal.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { readFinancialSlot } from '@/lib/pendingFinancialAttempts.js';

interface Reply { data: unknown; error: { code: string; message: string } | null }
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<Reply>>() }));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const customer = { id: 'customer-a', name: 'Test customer', loyalty_points: 1000 } as CustomerListRow;
const scope = (operation: 'loyalty_conversion' | 'loyalty_adjustment') => ({
  environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'profile-a', target: customer.id, operation,
});
function confirmed(args: Record<string, unknown>, operation = 'conversion') {
  return { data: { customer_id: args.p_customer_id, actor_id: 'profile-a', idempotency_key: args.p_idempotency_key,
    idempotent_replay: true, ...(operation === 'conversion'
      ? { ledger_id: 'ledger-1', points_converted: args.p_points, amount: Number(args.p_points) * 10, balance_after: 10000, expires_at: null }
      : { txn_id: 'txn-1', delta: args.p_delta, reason: args.p_reason, new_balance: 0, new_lifetime: 1000 }) }, error: null };
}
function mount(operation: 'conversion' | 'adjustment', balance = 1000) {
  const close = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{operation === 'conversion'
    ? <ConvertLoyaltyModal open onClose={close} customerId={customer.id} customerName={customer.name} loyaltyPoints={balance} />
    : <LoyaltyAdjustModal customer={{ ...customer, loyalty_points: balance }} onClose={close} />}</QueryClientProvider>);
  return { ...view, close, client };
}
function draftConversion() {
  fireEvent.change(screen.getByTestId('convert-points'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
}
function draftAdjustment() {
  fireEvent.click(screen.getByRole('radio', { name: '-' }));
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct duplicate points' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('loyalty durable recovery with real hooks and modals', () => {
  beforeEach(() => { vi.restoreAllMocks(); rpc.mockReset(); installFinancialBrowser(); resetFinancialSession(); vi.mocked(toast.success).mockClear(); });

  it('replays a lost conversion with the same payload/key after remount, even when the new balance is zero', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Response lost')).mockImplementation((_name, args) => Promise.resolve(confirmed(args)));
    const first = mount('conversion'); draftConversion();
    expect(await screen.findByRole('status')).toHaveTextContent('unconfirmed');
    expect(screen.getByTestId('convert-points')).toBeDisabled();
    const saved = readFinancialSlot(scope('loyalty_conversion'));
    first.unmount();
    const second = mount('conversion', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Check pending conversion' }));
    await waitFor(() => expect(second.close).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(saved?.status).toBe('pending');
    expect(readFinancialSlot(scope('loyalty_conversion'))?.status).toBe('resolved');
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it('replays a lost negative adjustment from the saved snapshot without checking it against the new zero balance', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Response lost')).mockImplementation((_name, args) => Promise.resolve(confirmed(args, 'adjustment')));
    const first = mount('adjustment'); draftAdjustment();
    expect(await screen.findByRole('status')).toHaveTextContent('unconfirmed');
    first.unmount();
    const second = mount('adjustment', 0);
    expect(screen.getByText('Correct duplicate points')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check pending adjustment' }));
    await waitFor(() => expect(second.close).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(readFinancialSlot(scope('loyalty_adjustment'))?.status).toBe('resolved');
  });

  it.each(['conversion', 'adjustment'] as const)('retains %s on malformed or unrelated successful responses', async (operation) => {
    rpc.mockImplementation((_name, args) => Promise.resolve({ ...confirmed(args, operation), data: { ...confirmed(args, operation).data, actor_id: 'other-actor' } }));
    const view = mount(operation);
    if (operation === 'conversion') draftConversion(); else draftAdjustment();
    expect(await screen.findByRole('status')).toHaveTextContent('unconfirmed');
    expect(view.close).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(readFinancialSlot(scope(operation === 'conversion' ? 'loyalty_conversion' : 'loyalty_adjustment'))?.status).toBe('pending');
  });

  it('preserves an uncertain adjustment after a later definitive refusal', async () => {
    rpc.mockRejectedValueOnce(new Error('lost')).mockResolvedValue({ data: null, error: { code: 'P0001', message: 'insufficient_balance' } });
    mount('adjustment'); draftAdjustment();
    await screen.findByRole('status');
    const saved = readFinancialSlot(scope('loyalty_adjustment'));
    fireEvent.click(screen.getByRole('button', { name: 'Check pending adjustment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('original result remains unconfirmed');
    expect(readFinancialSlot(scope('loyalty_adjustment'))).toEqual(saved);
  });

  it('releases a first period_locked refusal but preserves it after a response has been lost', async () => {
    const refusal = { data: null, error: { code: 'P0004', message: 'period_locked: date falls in closed period' } };
    rpc.mockResolvedValueOnce(refusal).mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue(refusal);
    mount('conversion'); draftConversion();
    expect(await screen.findByRole('alert')).toHaveTextContent('fiscal period is closed');
    expect(readFinancialSlot(scope('loyalty_conversion'))?.status).toBe('resolved');
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await screen.findByRole('status');
    const saved = readFinancialSlot(scope('loyalty_conversion'));
    fireEvent.click(screen.getByRole('button', { name: 'Check pending conversion' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('alert')).toHaveTextContent('original result remains unconfirmed');
    expect(readFinancialSlot(scope('loyalty_conversion'))).toEqual(saved);
    expect(rpc.mock.calls[0]![1].p_idempotency_key).not.toBe(rpc.mock.calls[1]![1].p_idempotency_key);
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[2]);
  });

  it.each(['conversion', 'adjustment'] as const)('ignores a late %s response after switching operators', async (operation) => {
    const response = deferred<ReturnType<typeof confirmed>>(); rpc.mockReturnValue(response.promise);
    const view = mount(operation);
    if (operation === 'conversion') draftConversion(); else draftAdjustment();
    await waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    const args = rpc.mock.calls[0]![1];
    act(() => financialTestAuth.setState({ user: { ...financialTestAuth.getState().user, id: 'profile-b' }, sessionToken: 'session-b' }));
    view.client.setQueryData(['customer-detail', customer.id], { owner: 'B' });
    await act(async () => { response.resolve(confirmed(args, operation)); await response.promise; });
    expect(view.close).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(view.client.getQueryState(['customer-detail', customer.id])?.isInvalidated).toBe(false);
    expect(readFinancialSlot(scope(operation === 'conversion' ? 'loyalty_conversion' : 'loyalty_adjustment'))?.status).toBe('pending');
  });

  it('does not send a conversion when native tab locking is missing', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    mount('conversion'); draftConversion();
    expect(await screen.findByRole('alert')).toHaveTextContent('locking is unavailable');
    expect(rpc).not.toHaveBeenCalled();
  });
});
