import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFinancialAttempts, FinancialAttemptError, financialStorageKey, subscribeFinancialAttempts } from '../financialAttempts.js';
const scope = { environment: 'https://dev.supabase.co', profileId: 'cashier', operation: 'refund' as const, target: 'order' };
const payload = { amount: 100 };
const runner = createFinancialAttempts<{ refund: typeof payload }>({
  validPayload: (_operation, _target, v) => typeof v === 'object' && v !== null && Object.keys(v).join() === 'amount' && (v as typeof payload).amount > 0,
  validSlot: (v) => typeof v === 'object' && v !== null && 'status' in v,
});
const options = { scope, payload, expectedRevision: null, current: () => true };
function locks() {
  const held = new Set<string>();
  const request = vi.fn(async (key: string, _options: LockOptions, fn: (lock: Lock | null) => Promise<unknown>) => {
    if (held.has(key)) return fn(null);
    held.add(key);
    try { return await fn({ name: key, mode: 'exclusive' }); } finally { held.delete(key); }
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
}
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); locks(); });
describe('shared durable financial runner', () => {
  it('writes before send, resumes frozen payload/key and leaves a revised tombstone', async () => {
    const revisions: string[] = [];
    const changed = vi.fn();
    const unsubscribe = subscribeFinancialAttempts(changed);
    const send = vi.fn((value: typeof payload, key: string) => {
      expect(runner.readFinancialSlot(scope)).toMatchObject({ status: 'pending', payload: value, idempotencyKey: key });
      return Promise.reject(new Error('lost ACK'));
    });
    await expect(runner.runFinancialAttempt({ ...options, send, onRevision: (r) => revisions.push(r) })).rejects.toThrow('lost ACK');
    const saved = runner.readFinancialSlot(scope)!;
    const confirm = vi.fn((_value: typeof payload, _key: string) => Promise.resolve('confirmed'));
    await runner.runFinancialAttempt({ ...options, expectedRevision: saved.revision, payload: { amount: 999 }, send: confirm, onRevision: (r) => revisions.push(r) });
    expect(confirm.mock.calls[0]).toEqual(send.mock.calls[0]);
    expect(runner.readFinancialSlot(scope)).toMatchObject({ status: 'resolved' });
    expect(revisions).toHaveLength(3); expect(changed).toHaveBeenCalledTimes(3); unsubscribe();
  });
  it('rejects concurrent and stale forms after success', async () => {
    let finish!: (value: string) => void;
    const send = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const first = runner.runFinancialAttempt({ ...options, send });
    await expect(runner.runFinancialAttempt({ ...options, send })).rejects.toThrow('another tab');
    finish('done'); await first;
    await expect(runner.runFinancialAttempt({ ...options, send })).rejects.toThrow('changed in another tab');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps UNKNOWN after a later definitive refusal', async () => {
    await expect(runner.runFinancialAttempt({ ...options, send: () => Promise.reject(new Error('lost')) })).rejects.toThrow('lost');
    const saved = runner.readFinancialSlot(scope)!;
    await expect(runner.runFinancialAttempt({ ...options, expectedRevision: saved.revision, send: () => Promise.reject(new FinancialAttemptError('forbidden', true)) })).rejects.toThrow('forbidden');
    expect(runner.readFinancialSlot(scope)).toEqual(saved);
    expect(runner.pendingFinancialTargets(scope.environment, scope.profileId, 'refund')).toEqual(['order']);
  });
  it('fails closed on absent locks, storage faults and identity change', async () => {
    const send = vi.fn();
    Object.defineProperty(navigator, 'locks', { value: undefined });
    await expect(runner.runFinancialAttempt({ ...options, send })).rejects.toThrow('locking is unavailable');
    locks();
    await expect(runner.runFinancialAttempt({ ...options, current: () => false, send })).rejects.toThrow('session changed');
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await expect(runner.runFinancialAttempt({ ...options, send })).rejects.toThrow('storage');
    set.mockRestore(); localStorage.setItem(financialStorageKey(scope), '{');
    await expect(runner.runFinancialAttempt({ ...options, send })).rejects.toThrow('storage');
    expect(send).not.toHaveBeenCalled();
  });
});
