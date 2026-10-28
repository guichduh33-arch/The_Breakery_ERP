import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validPayload } from '@/lib/pendingFinancialAttemptSchema.js';
import { financialStorageKey, readFinancialSlot, runFinancialAttempt } from '@/lib/pendingFinancialAttempts.js';
import { installFinancialBrowser, deferred } from '@/lib/__tests__/financialAttemptTestUtils.js';
import type { BankManageSnapshot, BankPostSnapshot } from '@/lib/bankAttemptSchema.js';
const rec = '11111111-1111-4111-8111-111111111111';
const bank = '22222222-2222-4222-8222-222222222222';
const gl = '33333333-3333-4333-8333-333333333333';
const payload: BankManageSnapshot = { kind: 'match',reconciliationId: rec,bankIds: [bank],glIds: [gl] };
const scope = { environment: 'https://rehearsal.supabase.co',profileId: 'operator-a',operation: 'bank_manage' as const,target: rec };
const options = { scope,payload,expectedRevision: null,current: () => true };
describe('durable bank operations',() => {
  beforeEach(() => { vi.restoreAllMocks(); installFinancialBrowser(); });
  it('uses closed snapshots and refuses secrets at every nested boundary',() => {
    expect(validPayload('bank_manage',rec,payload)).toBe(true);
    expect(validPayload('bank_manage',bank,payload)).toBe(false);
    expect(validPayload('bank_manage',rec,{ ...payload,pin: 'do-not-save' })).toBe(false);
    const post: BankPostSnapshot = { reconciliationId: rec,kind: 'net_fee',bankIds: [bank],bankGlIds: [gl],clearingIds: [],counterAccountId: gl,fee: '0.29',date: '2026-10-27',description: 'Actual bank fee' };
    expect(validPayload('bank_post',rec,post)).toBe(true);
    expect(validPayload('bank_post',rec,{ ...post,managerPin: 'do-not-save' })).toBe(false);
    expect(validPayload('bank_post',rec,{ ...post,fee: '0.291' })).toBe(false);
    expect(validPayload('bank_finalize',rec,{ reconciliationId: rec,transit: [{ gl_line_id: gl,reason: 'Settlement pending',jwt: 'do-not-save' }] })).toBe(false);
    expect(validPayload('bank_manage','new',{ kind: 'import',statement: { account_id: rec,period_start: '2026-10-01',period_end: '2026-10-31',currency: 'IDR',opening_balance: null,closing_balance: null,source_sha256: 'a'.repeat(64),file_name: 'bank.xlsx',sheet_name: 'Bank',duplicate_acknowledged: false,rows: [{ source_row: 2,date: '2026-10-01',amount: '0.29',description: 'Interest',balance: null,pin: 'do-not-save' }] } })).toBe(false);
  });
  it('saves before sending and reuses the identical request after a lost response',async () => {
    const ledger = new Map<string,unknown>(); const requests: unknown[] = [];
    const send = vi.fn((body: BankManageSnapshot,key: string) => {
      expect(readFinancialSlot(scope)?.status).toBe('pending'); requests.push({ body,key });
      if (!ledger.has(key)) { ledger.set(key,body); return Promise.reject(new Error('Response lost after commit')); }
      return Promise.resolve({ ok: true,match_id: gl });
    });
    await expect(runFinancialAttempt({ ...options,send })).rejects.toThrow('Response lost');
    const saved = readFinancialSlot(scope)!;
    await expect(runFinancialAttempt({ ...options,payload: { ...payload,bankIds: [gl] },expectedRevision: saved.revision,send })).resolves.toMatchObject({ match_id: gl });
    expect(requests[1]).toEqual(requests[0]); expect(ledger.size).toBe(1);
    expect(localStorage.getItem(financialStorageKey(scope))).not.toContain(bank);
  });
  it('blocks simultaneous tabs, stale revisions and cross-user recovery',async () => {
    const response = deferred<string>(); const send = vi.fn(() => response.promise);
    const first = runFinancialAttempt({ ...options,send });
    await expect(runFinancialAttempt({ ...options,send })).rejects.toThrow('another tab');
    expect(readFinancialSlot({ ...scope,profileId: 'operator-b' })).toBeNull();
    response.resolve('saved'); await first;
    await expect(runFinancialAttempt({ ...options,send })).rejects.toThrow('another tab');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
