import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRecordB2bPayment, validPaymentResult, type RecordB2bPaymentResult } from '../hooks/useRecordB2bPayment.js';
import { readFinancialSlot, runFinancialAttempt } from '@/lib/pendingFinancialAttempts.js';
import { deferred, financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';

const transport = vi.hoisted(() => ({ rpc: vi.fn(), ledger: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock('@/stores/authStore.js', async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('@/lib/supabase.js', () => ({ supabase: {
  rpc: transport.rpc,
  from: (table: string) => {
    expect(table).toBe('b2b_payments');
    return { select: (columns: string) => {
      transport.select(columns);
      return { eq: (column: string, value: string) => {
        transport.eq(column, value);
        return { maybeSingle: transport.ledger };
      } };
    } };
  },
} }));

const payload = { customerId: 'customer-a', amount: 100.25, method: 'store_credit' as const };
const scope = { environment: 'https://rehearsal.example.test', profileId: 'profile-a', operation: 'payment' as const, target: payload.customerId };
const allocation = [{ invoice_id: 'invoice-a', amount_applied: 100.25, fully_settled: true }];
const validResult: RecordB2bPaymentResult = {
  payment_id: 'payment-a', payment_number: 'BP-2026-001', je_id: 'journal-a',
  allocations: allocation, allocation, allocated_total: 100.25, unallocated: 0,
  customer_balance_after: 0, idempotent_replay: false,
};
interface Reply { data: unknown; error: { message: string; code?: string } | null }

function ledgerRow(overrides: Record<string, unknown> = {}) {
  const args = transport.rpc.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  return { id: 'payment-a', customer_id: payload.customerId, amount: args.p_amount, method: payload.method,
    idempotency_key: args.p_idempotency_key, payment_number: validResult.payment_number,
    journal_entry_id: validResult.je_id, ...overrides };
}

function setup(amount = payload.amount) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['customer-detail', payload.customerId], { store_credit_balance: payload.amount });
  const hook = renderHook(() => useRecordB2bPayment(), { wrapper: ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  const send = () => runFinancialAttempt({ scope, expectedRevision: readFinancialSlot(scope)?.revision ?? null,
    payload: { ...payload, amount }, current: () => true,
    send: (saved, key) => hook.result.current.mutateAsync({ ...saved, idempotencyKey: key }),
  });
  return { client, send };
}

async function expectUnknown(send: () => Promise<unknown>) {
  await act(async () => {
    await expect(send()).rejects.toMatchObject({ definitive: false });
  });
  const pending = readFinancialSlot(scope);
  expect(pending).toMatchObject({ status: 'pending', payload });
  return pending;
}

describe('B2B durable resolution requires a matching payment ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks(); installFinancialBrowser(); resetFinancialSession();
    transport.rpc.mockReset().mockResolvedValue({ data: validResult, error: null });
    transport.ledger.mockReset().mockImplementation(() => Promise.resolve({ data: ledgerRow(), error: null }));
  });

  function resultForAmount(amount: number): RecordB2bPaymentResult {
    const lines = [{ invoice_id: 'invoice-a', amount_applied: amount, fully_settled: true }];
    return { ...validResult, allocations: lines, allocation: lines, allocated_total: amount };
  }

  it.each([0.01, 0.29, 1.01, 134217728.55, 999_999_999_999.98, 999_999_999_999.99])(
    'confirms the SQL NUMERIC(14,2) amount %s through the hook and matching ledger', async (amount) => {
      transport.rpc.mockResolvedValue({ data: resultForAmount(amount), error: null });
      const { send } = setup(amount);
      await act(async () => { await expect(send()).resolves.toMatchObject({ allocated_total: amount }); });
      expect(transport.ledger).toHaveBeenCalledTimes(1);
      expect(transport.rpc).toHaveBeenCalledWith('record_b2b_payment_v5', expect.objectContaining({ p_amount: amount }));
      expect(readFinancialSlot(scope)?.status).toBe('resolved');
    },
  );

  it.each([1.001, 1.005])('keeps UNKNOWN for a significant third decimal in %s', async (amount) => {
    transport.rpc.mockResolvedValue({ data: resultForAmount(amount), error: null });
    const { send } = setup(amount);
    await act(async () => { await expect(send()).rejects.toMatchObject({ definitive: false }); });
    expect(readFinancialSlot(scope)).toMatchObject({ status: 'pending', payload: { ...payload, amount } });
    expect(transport.ledger).not.toHaveBeenCalled();
  });

  it.each([0, -0.01, 0.001, Number.MIN_VALUE, 1.001, 1.005, 999_999_999_999.999,
    1_000_000_000_000, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, NaN, Infinity, -Infinity])(
    'rejects non-monetary or out-of-range amount %s', (amount) => {
      expect(validPaymentResult(resultForAmount(amount), amount)).toBe(false);
    },
  );

  it.each([
    ['id', 'different-payment'], ['customer_id', 'customer-b'], ['idempotency_key', 'different-key'],
    ['amount', 50], ['method', 'cash'], ['payment_number', 'BP-OTHER'], ['journal_entry_id', 'journal-b'],
  ])('keeps UNKNOWN for a mismatched ledger %s and retries the original attempt', async (field, value) => {
    transport.ledger.mockImplementationOnce(() => Promise.resolve({ data: ledgerRow({ [field]: value }), error: null }));
    const { send, client } = setup();
    const pending = await expectUnknown(send);
    expect(client.getQueryState(['customer-detail', payload.customerId])?.isInvalidated).toBe(false);
    await act(async () => { await expect(send()).resolves.toMatchObject({ payment_id: 'payment-a' }); });
    expect(transport.rpc.mock.calls[1]?.[1]).toEqual(transport.rpc.mock.calls[0]?.[1]);
    expect(pending?.status === 'pending' && pending.idempotencyKey).toBe(
      (transport.rpc.mock.calls[1]?.[1] as Record<string, unknown>).p_idempotency_key);
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
    expect(transport.eq).toHaveBeenCalledWith('id', 'payment-a');
    expect(transport.select).toHaveBeenCalledWith('id,customer_id,idempotency_key,amount,method,payment_number,journal_entry_id');
  });

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'RLS or connection unavailable' } },
  ])('keeps UNKNOWN if the ledger cannot be read: %j', async (reply) => {
    transport.ledger.mockResolvedValue(reply);
    await expectUnknown(setup().send);
  });

  it('keeps UNKNOWN if the ledger request rejects', async () => {
    transport.ledger.mockRejectedValue(new TypeError('Ledger connection lost'));
    const { send } = setup();
    await act(async () => { await expect(send()).rejects.toThrow('Ledger connection lost'); });
    expect(readFinancialSlot(scope)).toMatchObject({ status: 'pending', payload });
  });

  it.each([
    { allocations: [], allocation: [], allocated_total: 0 },
    { allocated_total: 100 },
    { unallocated: 1 },
    { allocations: [...allocation, ...allocation], allocation: [...allocation, ...allocation], allocated_total: 200.5 },
    { allocation: [] },
    { allocation: [{ invoice_id: 'invoice-b', amount_applied: 100.25 }] },
    { allocation: [{ invoice_id: 'invoice-a', amount_applied: 100 }] },
    { allocation: [{ ...allocation[0], fully_settled: false }] },
    { allocation: [...allocation, ...allocation] },
    { allocations: [{ invoice_id: 'invoice-a', amount_applied: 100.251 }] },
  ])('rejects inconsistent amounts or allocation aliases before ledger resolution: %j', async (change) => {
    transport.rpc.mockResolvedValue({ data: { ...validResult, ...change }, error: null });
    await expectUnknown(setup().send);
    expect(transport.ledger).not.toHaveBeenCalled();
  });

  it('accepts a coherent historical replay with a genuine unallocated remainder', async () => {
    const historical = [{ invoice_id: 'invoice-a', amount_applied: 70 }];
    transport.rpc.mockResolvedValue({ data: { ...validResult, allocations: historical, allocation: historical,
      allocated_total: 70, unallocated: 30.25, idempotent_replay: true }, error: null });
    const { send } = setup();
    await act(async () => { await expect(send()).resolves.toMatchObject({ unallocated: 30.25 }); });
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });

  it('stops before sending when no session is active', async () => {
    const { send } = setup();
    financialTestAuth.setState({ isAuthenticated: false });
    await expectUnknown(send);
    expect(transport.rpc).not.toHaveBeenCalled();
    expect(transport.ledger).not.toHaveBeenCalled();
  });

  it.each(['RPC', 'ledger'])('keeps UNKNOWN when the session changes during the %s request', async (stage) => {
    const response = deferred<Reply>();
    if (stage === 'RPC') transport.rpc.mockReturnValue(response.promise);
    else transport.ledger.mockReturnValue(response.promise);
    const { send, client } = setup();
    let attempt!: Promise<unknown>;
    await act(async () => {
      attempt = send();
      // Attach a rejection handler immediately; the assertion below still reads it.
      void attempt.catch(() => undefined);
      await Promise.resolve(); await Promise.resolve();
    });
    expect(stage === 'RPC' ? transport.rpc : transport.ledger).toHaveBeenCalledTimes(1);
    financialTestAuth.setState({ sessionToken: 'renewed-session' });
    await act(async () => {
      response.resolve({ data: stage === 'RPC' ? validResult : ledgerRow(), error: null });
      await expect(attempt).rejects.toMatchObject({ definitive: false });
    });
    expect(readFinancialSlot(scope)?.status).toBe('pending');
    expect(client.getQueryState(['customer-detail', payload.customerId])?.isInvalidated).toBe(false);
    if (stage === 'RPC') expect(transport.ledger).not.toHaveBeenCalled();
  });
});
