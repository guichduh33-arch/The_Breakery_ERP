// Décision 2026-11-21 : créditer des points exige un PIN manager ; un débit
// non. Le PIN part dans le mint du nonce, jamais dans la reprise persistée.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoyaltyAdjustModal } from '../components/LoyaltyAdjustModal.js';
import type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js';
import { installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { financialStorageKey } from '@/lib/pendingFinancialAttempts.js';

interface Reply { data: unknown; error: { code: string; message: string } | null }
const { rpc, mint } = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<Reply>>(),
  mint: vi.fn<(pin: string) => Promise<string>>(),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));
vi.mock('../hooks/useMintLoyaltyPointsAuthorization.js', () => ({ mintLoyaltyPointsAuthorization: mint }));
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const customer = { id: 'customer-a', name: 'Test customer', loyalty_points: 1000 } as CustomerListRow;
const scope = { environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'profile-a', target: customer.id, operation: 'loyalty_adjustment' as const };

function confirmed(args: Record<string, unknown>): Reply {
  return { data: { customer_id: args.p_customer_id, actor_id: 'profile-a', idempotency_key: args.p_idempotency_key,
    idempotent_replay: false, txn_id: 'txn-1', delta: args.p_delta, reason: args.p_reason, new_balance: 1500, new_lifetime: 1500 }, error: null };
}
function mount() {
  const close = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><LoyaltyAdjustModal customer={customer} onClose={close} /></QueryClientProvider>);
  return { close };
}
function draftCredit(pin?: string) {
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Goodwill bonus' } });
  if (pin !== undefined) fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: pin } });
}

describe('loyalty credit manager PIN', () => {
  beforeEach(() => { rpc.mockReset(); mint.mockReset(); installFinancialBrowser(); resetFinancialSession(); });

  it('asks for a 6-digit manager PIN only to add points', () => {
    mount();
    draftCredit();
    expect(screen.getByLabelText('Manager PIN')).toBeInTheDocument();
    expect(screen.getByText(/6 digits/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '12a4' } });
    expect(screen.getByLabelText('Manager PIN')).toHaveValue('124');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '-' }));
    expect(screen.queryByLabelText('Manager PIN')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();
  });

  it('mints the nonce with the PIN, sends it to the RPC, and never persists the PIN', async () => {
    mint.mockResolvedValue('auth-1');
    let stored: string | null = null;
    rpc.mockImplementation((_name, args) => {
      stored = localStorage.getItem(financialStorageKey(scope));
      return Promise.resolve(confirmed(args));
    });
    const { close } = mount();
    draftCredit('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mint).toHaveBeenCalledWith('123456');
    expect(rpc).toHaveBeenCalledWith('adjust_loyalty_points_v4', expect.objectContaining({ p_delta: 500, p_authorization_id: 'auth-1' }));
    expect(stored).not.toBeNull();
    expect(stored).not.toMatch(/123456|managerPin/);
  });

  it.each([
    [401, 'Invalid manager PIN. Please retry.'],
    [403, 'PIN rejected or authorization expired'],
    [429, 'Too many PIN attempts. Wait a minute and retry.'],
  ])('a mint refusal %i reads clearly and clears the PIN but keeps the draft', async (status, copy) => {
    mint.mockRejectedValue(Object.assign(new Error('refused'), { status }));
    mount();
    draftCredit('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Manager PIN')).toHaveValue('');
    expect(screen.getByLabelText('Amount')).toHaveValue(500);
    expect(screen.getByLabelText('Reason')).toHaveValue('Goodwill bonus');
  });

  it('a debit goes straight to the RPC, without a PIN or a nonce', async () => {
    rpc.mockImplementation((_name, args) => Promise.resolve(confirmed(args)));
    const { close } = mount();
    fireEvent.click(screen.getByRole('radio', { name: '-' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mint).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_authorization_id');
  });

  it('a pending credit asks for a PIN again before it can be checked', async () => {
    mint.mockResolvedValue('auth-1');
    rpc.mockRejectedValueOnce(new TypeError('Response lost')).mockImplementation((_name, args) => Promise.resolve(confirmed(args)));
    const { close } = mount();
    draftCredit('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByRole('status')).toHaveTextContent('unconfirmed');
    const check = screen.getByRole('button', { name: 'Check pending adjustment' });
    expect(check).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Manager PIN'), { target: { value: '654321' } });
    fireEvent.click(check);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mint).toHaveBeenLastCalledWith('654321');
    expect(rpc.mock.calls[1]![1].p_idempotency_key).toBe(rpc.mock.calls[0]![1].p_idempotency_key);
  });
});
