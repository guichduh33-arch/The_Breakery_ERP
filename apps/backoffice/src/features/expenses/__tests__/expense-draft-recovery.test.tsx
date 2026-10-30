import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useExpenseDraftCreation } from '../hooks/useExpenseDraftCreation.js';
import { useFinancialAttempt } from '@/lib/useFinancialAttempt.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { readFinancialSlot, financialStorageKey } from '@/lib/pendingFinancialAttempts.js';
import { expenseDraftPointerKey, readExpenseDraftPointer, startNewExpenseDraft } from '../utils/expenseDraftPointer.js';

const {rpc, readRow} = vi.hoisted(() => ({rpc: vi.fn(), readRow: vi.fn()}));
vi.mock('@/lib/supabase.js', () => ({supabase: {rpc, from: () => ({select: () => ({eq: () => ({maybeSingle: readRow})})})}}));
vi.mock('@/stores/authStore.js', async () => ({useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth}));
const expenseId = '00000000-0000-4000-8000-000000000001';
const payload = {expense_term_id: '00000000-0000-4000-8000-000000000003', remarks: 'October bill', category_id: '00000000-0000-4000-8000-000000000002', amount: 250000, vat_amount: 0,
  payment_method: 'cash' as const, description: 'Electricity bill', expense_date: '2026-10-26'};
const scope = {environment: import.meta.env.VITE_SUPABASE_URL as string, profileId: 'profile-a'};
const creationScope = {...scope, operation: 'expense_creation' as const, target: 'new'};
function wrapper({children}: {children: ReactNode}) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function mount() {return renderHook(() => useExpenseDraftCreation(), {wrapper});}

describe('expense creation durable recovery', () => {
  beforeEach(() => {vi.restoreAllMocks(); installFinancialBrowser(); resetFinancialSession(); rpc.mockReset(); readRow.mockReset();
    rpc.mockResolvedValue({data: expenseId, error: null}); readRow.mockResolvedValue({data: {id: expenseId, created_by: 'profile-a'}, error: null});});
  it('persists the real server ID before resolving the pending save', async () => {
    const view = mount(); await act(async () => {await view.result.current.save(payload);});
    expect(readExpenseDraftPointer(scope)).toEqual({version: 1, status: 'saved', expenseId});
    expect(readFinancialSlot(creationScope)?.status).toBe('resolved');
    expect(rpc).toHaveBeenCalledWith('create_expense_v4', expect.objectContaining({p_description: 'Electricity bill', p_expense_term_id: payload.expense_term_id, p_remarks: 'October bill'}));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('p_receipt_url');
  });
  it('still reads a legacy pending payload without the new fields', async () => {
    const {expense_term_id: _term, remarks: _remarks, ...legacy} = payload;
    const view = mount(); await act(async () => {await view.result.current.save(legacy);});
    expect(readExpenseDraftPointer(scope)?.status).toBe('saved');
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_expense_term_id');
  });
  it('replays a lost response after remount using the same key and snapshot', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Response lost'));
    const first = mount(); await act(async () => {await first.result.current.save(payload);});
    expect(readFinancialSlot(creationScope)?.status).toBe('pending'); first.unmount();
    const second = mount(); await act(async () => {await second.result.current.save({...payload, amount: 1});});
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(readExpenseDraftPointer(scope)?.status).toBe('saved');
  });
  it('keeps the key when the server saved but persisting its pointer failed', async () => {
    const original = Storage.prototype.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if(key === expenseDraftPointerKey(scope)) throw new DOMException('Disk full');
      original(key, value);
    });
    const view = mount(); await act(async () => {await view.result.current.save(payload);});
    expect(readFinancialSlot(creationScope)?.status).toBe('pending');
    vi.restoreAllMocks(); await act(async () => {await view.result.current.save(payload);});
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]); expect(readExpenseDraftPointer(scope)?.status).toBe('saved');
  });
  it.each(['bad-id', 'wrong-owner'])('retains an unconfirmed save on %s confirmation', async kind => {
    if(kind === 'bad-id') rpc.mockResolvedValue({data: {id: expenseId}, error: null});
    else readRow.mockResolvedValue({data: {id: expenseId, created_by: 'profile-b'}, error: null});
    const view = mount(); await act(async () => {await view.result.current.save(payload);});
    expect(readFinancialSlot(creationScope)?.status).toBe('pending'); expect(readExpenseDraftPointer(scope)).toBeNull();
  });
  it('allows correcting a first proven refusal but preserves a previous uncertain attempt', async () => {
    rpc.mockResolvedValue({data: null, error: {code: '23503', message: 'Invalid category'}});
    const first = mount(); await act(async () => {await first.result.current.save(payload);});
    expect(readFinancialSlot(creationScope)?.status).toBe('resolved'); first.unmount();
    rpc.mockRejectedValueOnce(new Error('Response lost'));
    const second = mount(); await act(async () => {await second.result.current.save(payload);});
    await act(async () => {await second.result.current.save(payload);});
    expect(readFinancialSlot(creationScope)?.status).toBe('pending');
  });
  it('does not send without native tab locking', async () => {
    Object.defineProperty(navigator, 'locks', {configurable: true, value: undefined});
    const view = mount(); await act(async () => {await view.result.current.save(payload);}); expect(rpc).not.toHaveBeenCalled();
  });
  it('does not start a new draft while another tab holds the save lock', async () => {
    const browser = installFinancialBrowser(); browser.held.add(financialStorageKey(creationScope));
    await expect(startNewExpenseDraft(scope, () => true)).rejects.toThrow('another tab');
    expect(readExpenseDraftPointer(scope)).toBeNull();
  });
  it('does not replace a pending save with a new draft', async () => {
    rpc.mockRejectedValueOnce(new Error('Response lost')); const view = mount();
    await act(async () => {await view.result.current.save(payload);});
    await expect(startNewExpenseDraft(scope, () => true)).rejects.toThrow('unconfirmed save');
    expect(readFinancialSlot(creationScope)?.status).toBe('pending');
  });
  it('retains the old operator attempt when the session changes before confirmation', async () => {
    const response = deferred<{data: string; error: null}>(); rpc.mockReturnValue(response.promise);
    const view = mount(); let pending!: ReturnType<typeof view.result.current.save>;
    act(() => {pending = view.result.current.save(payload);});
    await act(async () => {await Promise.resolve(); financialTestAuth.setState({sessionToken: 'renewed-session'});});
    await act(async () => {response.resolve({data: expenseId, error: null}); expect((await pending).current).toBe(false);});
    expect(readFinancialSlot(creationScope)?.status).toBe('pending'); expect(readExpenseDraftPointer(scope)).toBeNull();
  });
});

describe('financial callbacks cannot borrow a new session or target', () => {
  beforeEach(() => {installFinancialBrowser(); resetFinancialSession();});
  it.each(['token', 'profile', 'target', 'unmount'] as const)('rejects a callback captured before %s changed', async change => {
    const view = renderHook(({target}) => useFinancialAttempt('expense_creation', target, true), {initialProps: {target: 'new'}});
    const stale = view.result.current.submit; const send = vi.fn();
    if(change === 'token') act(() => {financialTestAuth.setState({sessionToken: 'renewed-session'});});
    if(change === 'profile') act(() => {financialTestAuth.setState({user: {...financialTestAuth.getState().user, id: 'profile-b'}});});
    if(change === 'target') view.rerender({target: 'different'});
    if(change === 'unmount') view.unmount();
    let outcome;
    await act(async () => {outcome = await stale(payload, send);});
    expect(outcome).toEqual(expect.objectContaining({current: false})); expect(send).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
