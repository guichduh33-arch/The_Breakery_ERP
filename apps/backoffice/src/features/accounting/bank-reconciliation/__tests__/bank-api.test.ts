import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, financialTestAuth, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import type { BankPostSnapshot } from '@/lib/bankAttemptSchema.js';
const mockRpc = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { code: string; message: string } | null }>>());
vi.mock('@/lib/supabase.js',() => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
vi.mock('@/stores/authStore.js',async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
import { readBankCatalog, sendBankManage, sendBankPost } from '../api.js';
import { parseDetail } from '../contracts.js';
const rec = '11111111-1111-4111-8111-111111111111';
const line = '22222222-2222-4222-8222-222222222222';
const match = '33333333-3333-4333-8333-333333333333';
const post: BankPostSnapshot = { reconciliationId: rec,kind: 'net_fee',bankIds: [line],bankGlIds: [match],clearingIds: [],counterAccountId: match,fee: '2000.29',date: '2026-10-27',description: 'Actual fees on receipt' };
describe('bank RPC boundary',() => {
  beforeEach(() => { mockRpc.mockReset(); resetFinancialSession(); });
  it('posts only the requested fees and passes PIN as an RPC argument, outside the durable payload',async () => {
    mockRpc.mockResolvedValue({ data: { ok: true,entry_id: line,je_id: rec,bank_gl_line_id: match,match_id: match },error: null });
    await sendBankPost(post,rec,'654321',() => true);
    expect(mockRpc).toHaveBeenCalledWith('bank_reconciliation_post_v4',expect.objectContaining({ p_kind: 'net_fee',p_bank_gl_line_ids: [match],p_clearing_line_ids: [],p_fee_amount: 2000.29,p_manager_pin: '654321',p_idempotency_key: rec }));
    expect(post).not.toHaveProperty('pin');
  });
  it('treats committed invalid PIN refusals as failures, and never invents success from a malformed response',async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: false,error: 'invalid_pin' },error: null });
    await expect(sendBankPost(post,rec,'wrong',() => true)).rejects.toMatchObject({ definitive: true,message: 'Incorrect PIN. Please try again.' });
    mockRpc.mockResolvedValueOnce({ data: { ok: true,je_id: rec },error: null });
    await expect(sendBankPost(post,rec,'654321',() => true)).rejects.toMatchObject({ definitive: false });
  });
  it('does not send after a session change and refuses late read responses',async () => {
    await expect(sendBankManage({ kind: 'match',reconciliationId: rec,bankIds: [line],glIds: [match] },rec,() => false)).rejects.toThrow('session changed');
    expect(mockRpc).not.toHaveBeenCalled();
    const pending = deferred<{ data: unknown; error: null }>(); mockRpc.mockReturnValueOnce(pending.promise);
    const request = readBankCatalog(); financialTestAuth.setState({ sessionToken: 'new-session' });
    pending.resolve({ data: { bank_accounts: [],counter_accounts: [],clearing_accounts: [] },error: null });
    await expect(request).rejects.toThrow('session changed');
  });
  it('normalizes finalized snapshot associations and signed debit/credit amounts',() => {
    const value = parseDetail({ reconciliation: { id: rec,account_id: line,period_start: '2026-10-01',period_end: '2026-10-31',status: 'finalized',opening_balance: 0,closing_balance: 100.29 },
      bank_lines: [{ id: line,ordinal: 1,transaction_date: '2026-10-27',amount: 100.29,description: 'Receipt' }],
      gl_lines: [{ id: rec,entry_date: '2026-10-27',entry_number: 'JE-1',debit: 100.29,credit: 0 }],
      matches: [{ id: match,bank_line_ids: [line],gl_line_ids: [rec],amount: 100.29,removed_at: null }],imports: [],entries: [],
      balances: { bank_opening: 0,bank_closing: 100.29,gl_opening: 0,gl_closing: 100.29,bank_total: 100.29 },next_bank_after: null,next_gl_after: null,match_history_truncated: false });
    expect(value.gl_lines[0]).toMatchObject({ amount: '100.29',match_id: match });
    expect(value.bank_lines[0]?.match_id).toBe(match);
    expect(() => parseDetail({ ...value,gl_lines: [{}] })).toThrow('identifier');
  });
});
