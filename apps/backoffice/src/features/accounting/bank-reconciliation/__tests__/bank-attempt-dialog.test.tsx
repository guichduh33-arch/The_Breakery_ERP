import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { readFinancialSlot } from '@/lib/pendingFinancialAttempts.js';
const mockRpc = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { code: string; message: string } | null }>>());
vi.mock('@/lib/supabase.js',() => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
vi.mock('@/stores/authStore.js',async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
import { BankAttemptDialog } from '../BankAttemptDialog.js';
const rec = '11111111-1111-4111-8111-111111111111';
const line = '22222222-2222-4222-8222-222222222222';
const match = '33333333-3333-4333-8333-333333333333';
const scope = { environment: import.meta.env.VITE_SUPABASE_URL as string,profileId: 'profile-a',operation: 'bank_manage' as const,target: rec };
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
describe('bank confirmation and recovery UI',() => {
  beforeEach(() => { mockRpc.mockReset(); installFinancialBrowser(); resetFinancialSession(); });
  it('keeps an uncertain match and retries the original payload and key after reopening',async () => {
    const close = vi.fn(); const payload = { kind: 'match' as const,reconciliationId: rec,bankIds: [line],glIds: [match] };
    mockRpc.mockRejectedValueOnce(new Error('Response lost')).mockResolvedValueOnce({ data: { ok: true,match_id: match,amount: 0.29 },error: null });
    const first = render(<BankAttemptDialog operation="bank_manage" target={rec} payload={payload} onClose={close} />, { wrapper });
    fireEvent.click(screen.getByRole('button',{ name: 'Confirm' }));
    await screen.findByText('Response lost'); expect(readFinancialSlot(scope)?.status).toBe('pending');
    expect(close).not.toHaveBeenCalled(); first.unmount();
    render(<BankAttemptDialog operation="bank_manage" target={rec} payload={{ ...payload,bankIds: [match] }} onClose={close} />,{ wrapper });
    fireEvent.click(screen.getByRole('button',{ name: 'Check pending operation' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(mockRpc.mock.calls[1]).toEqual(mockRpc.mock.calls[0]); expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });
  it('blocks when secure storage or permissions are unavailable',() => {
    financialTestAuth.setState({ hasPermission: () => false });
    render(<BankAttemptDialog operation="bank_manage" target={rec} payload={{ kind: 'balances',reconciliationId: rec,opening: null,closing: null }} onClose={() => undefined} />,{ wrapper });
    expect(screen.getByRole('button',{ name: 'Confirm' })).toBeDisabled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('does not close or update the next operator after a late response',async () => {
    const pending = deferred<{ data: unknown; error: null }>(); mockRpc.mockReturnValueOnce(pending.promise); const close = vi.fn();
    render(<BankAttemptDialog operation="bank_manage" target={rec} payload={{ kind: 'match',reconciliationId: rec,bankIds: [line],glIds: [match] }} onClose={close} />,{ wrapper });
    fireEvent.click(screen.getByRole('button',{ name: 'Confirm' }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    act(() => financialTestAuth.setState({ sessionToken: 'new-session' }));
    await act(async () => { pending.resolve({ data: { ok: true,match_id: match,amount: 100 },error: null }); await pending.promise; });
    expect(close).not.toHaveBeenCalled(); expect(readFinancialSlot(scope)?.status).toBe('pending');
  });
  it('does not persist the PIN and handles invalid PIN as a refusal',async () => {
    mockRpc.mockResolvedValue({ data: { ok: false,error: 'invalid_pin' },error: null });
    render(<BankAttemptDialog operation="bank_post" target={rec} payload={{ reconciliationId: rec,kind: 'fee',bankIds: [line],clearingIds: [],bankGlIds: [],counterAccountId: match,fee: '0.00',date: '2026-10-27',description: 'Actual bank fee' }} onClose={() => undefined} />,{ wrapper });
    fireEvent.change(screen.getByLabelText('Manager PIN'),{ target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button',{ name: 'Confirm' }));
    await screen.findByText('Incorrect PIN. Please try again.');
    const stored = Array.from({ length: localStorage.length },(_,index) => localStorage.getItem(localStorage.key(index)!)).join('');
    expect(stored).not.toContain('654321'); expect(stored).not.toContain('manager_pin');
    expect(screen.getByLabelText('Manager PIN')).toHaveValue('');
  });
});
