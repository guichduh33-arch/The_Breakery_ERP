import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancialAttemptError, financialStorageKey, readFinancialSlot, runFinancialAttempt } from '../pendingFinancialAttempts.js';
import { deferred, installFinancialBrowser } from './financialAttemptTestUtils.js';
import type { PaymentSnapshot } from '../pendingFinancialAttemptSchema.js';
import { validPayload } from '../pendingFinancialAttemptSchema.js';
import { FinancialAttemptError as SharedFinancialAttemptError } from '@breakery/utils';

const scope = { environment: 'https://dev.supabase.co', profileId: 'profile-a', operation: 'payment' as const, target: 'customer-a' };
const payload = { customerId: 'customer-a', amount: 50, method: 'store_credit' as const, invoiceIds: ['invoice-b', 'invoice-a'] };
const current = () => true;
const options = { scope, payload, expectedRevision: null, current };

describe('durable financial attempts', () => {
  beforeEach(() => { vi.restoreAllMocks(); installFinancialBrowser(); });
  it('accepts only closed loyalty snapshots and rejects secrets, changed targets and non-integer amounts', () => {
    const conversion = { customerId: 'customer-a', points: 100 };
    const adjustment = { customerId: 'customer-a', delta: -100, reason: 'Correct duplicate points' };
    expect(validPayload('loyalty_conversion', 'customer-a', conversion)).toBe(true);
    expect(validPayload('loyalty_adjustment', 'customer-a', adjustment)).toBe(true);
    expect(validPayload('loyalty_conversion', 'customer-b', conversion)).toBe(false);
    expect(validPayload('loyalty_adjustment', 'customer-b', adjustment)).toBe(false);
    for (const points of [0, -100, 150, 100.5, 2147483700, NaN]) {
      expect(validPayload('loyalty_conversion', 'customer-a', { ...conversion, points })).toBe(false);
    }
    for (const delta of [0, 0.5, 1000001, NaN]) {
      expect(validPayload('loyalty_adjustment', 'customer-a', { ...adjustment, delta })).toBe(false);
    }
    expect(validPayload('loyalty_conversion', 'customer-a', { ...conversion, pin: 'never-save' })).toBe(false);
    expect(validPayload('loyalty_adjustment', 'customer-a', { ...adjustment, token: 'never-save' })).toBe(false);
  });
  it('reads existing v1 strings and preserves the shared error identity', async () => {
    expect(FinancialAttemptError).toBe(SharedFinancialAttemptError);
    const key = 'breakery:financial-attempt:v1:https%3A%2F%2Fdev.supabase.co:profile-a:payment:customer-a';
    expect(financialStorageKey(scope)).toBe(key);
    const revision = '11111111-2222-4333-8444-555555555555';
    const idempotencyKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    localStorage.setItem(key, JSON.stringify({ version: 1, revision, operation: 'payment', target: 'customer-a', status: 'pending', idempotencyKey, payload }));
    const send = vi.fn(() => Promise.resolve('ok'));
    await runFinancialAttempt({ ...options, expectedRevision: revision, send });
    expect(send).toHaveBeenCalledWith(payload, idempotencyKey);
    const tombstone = localStorage.getItem(key)!;
    expect(JSON.parse(tombstone)).toMatchObject({ version: 1, status: 'resolved', operation: 'payment', target: 'customer-a' });
    localStorage.setItem(key, tombstone);
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
  });

  it('writes before sending, survives a lost committed response, and replays the identical key and snapshot', async () => {
    const ledger = new Map<string, unknown>();
    const requests: unknown[] = [];
    const send = vi.fn((body: PaymentSnapshot, key: string) => {
      expect(readFinancialSlot(scope)?.status).toBe('pending');
      requests.push({ body, key });
      if (!ledger.has(key)) { ledger.set(key, body); return Promise.reject(new TypeError('Response lost after commit')); }
      return Promise.resolve({ payment_id: 'one-payment' });
    });
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('Response lost');
    const saved = readFinancialSlot(scope)!;
    // Un autre document/rechargement ne possède que la copie durable.
    await expect(runFinancialAttempt({ ...options, payload: { ...payload, amount: 999 },
      expectedRevision: saved.revision, send })).resolves.toEqual({ payment_id: 'one-payment' });
    expect(requests[1]).toEqual(requests[0]);
    expect(ledger.size).toBe(1);
    expect(readFinancialSlot(scope)?.status).toBe('resolved');
    expect(localStorage.getItem(financialStorageKey(scope))).not.toContain('invoice-b');
  });

  it('keeps UNKNOWN after a known rejection, but releases a definitive first failure', async () => {
    const refusal = new FinancialAttemptError('Incorrect PIN', true);
    await expect(runFinancialAttempt({ ...options, send: () => Promise.reject(refusal) })).rejects.toThrow('Incorrect PIN');
    const terminal = readFinancialSlot(scope)!;
    expect(terminal.status).toBe('resolved');
    await expect(runFinancialAttempt({ ...options, expectedRevision: terminal.revision,
      send: () => Promise.reject(new Error('timeout')) })).rejects.toThrow('timeout');
    const pending = readFinancialSlot(scope)!;
    await expect(runFinancialAttempt({ ...options, expectedRevision: pending.revision,
      send: () => Promise.reject(refusal) })).rejects.toThrow('Incorrect PIN');
    expect(readFinancialSlot(scope)).toEqual(pending);
  });

  it('excludes concurrent tabs and a stale form even after the first operation succeeds', async () => {
    const response = deferred<string>();
    const send = vi.fn((_body: PaymentSnapshot, _key: string) => response.promise);
    const first = runFinancialAttempt({ ...options, send });
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('another tab');
    expect(send).toHaveBeenCalledTimes(1);
    response.resolve('confirmed');
    await first;
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('changed in another tab');
    expect(send).toHaveBeenCalledTimes(1);
    const terminal = readFinancialSlot(scope)!;
    await runFinancialAttempt({ ...options, expectedRevision: terminal.revision, send });
    expect(send.mock.calls[1]?.[1]).not.toBe(send.mock.calls[0]?.[1]);
  });

  it('fails closed on absent locks, lock errors, storage failures and corrupted snapshots', async () => {
    const send = vi.fn();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('locking is unavailable');
    installFinancialBrowser().request.mockRejectedValue(new Error('Denied'));
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('locking failed');
    installFinancialBrowser();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('storage');
    set.mockRestore();
    localStorage.setItem(financialStorageKey(scope), '{broken');
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('storage');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects additional secret fields, isolates profile/environment/target, and rechecks session under lock', async () => {
    const send = vi.fn(() => Promise.reject(new Error('lost')));
    await expect(runFinancialAttempt({ ...options, payload: Object.assign({}, payload, { managerPin: 'secret-pin' }), send })).rejects.toThrow('invalid');
    await expect(runFinancialAttempt({ ...options, current: () => false, send })).rejects.toThrow('session changed');
    expect(send).not.toHaveBeenCalled();
    await expect(runFinancialAttempt({ ...options, send })).rejects.toThrow('lost');
    expect(readFinancialSlot({ ...scope, profileId: 'profile-b' })).toBeNull();
    expect(readFinancialSlot({ ...scope, environment: 'https://prod.supabase.co' })).toBeNull();
    expect(readFinancialSlot({ ...scope, target: 'customer-b' })).toBeNull();
    const raw = localStorage.getItem(financialStorageKey(scope))!;
    expect(raw).not.toMatch(/secret-pin|managerPin|sessionToken|Authorization|access_token|headers/);
  });
});
