// supabase/tests/functions/expenses.test.ts
//
// Session 13 / Phase 3.B — live Vitest integration tests for the expense RPCs.
//
// Coverage:
//   - happy cycle : create -> submit -> approve -> JE balanced -> pay.
//   - JE shape on credit + VAT (3 lines).
//   - permission gate : cashier blocked from create.
//   - idempotency_key returns same expense id on replay.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

interface JeRow { id: string; total_debit: number; total_credit: number }

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('expenses — RPC cycle (Phase 3.B)', () => {
  let managerToken: string;
  let adminToken:   string;
  let cashierToken: string;
  let utilitiesCategoryId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    adminToken   = await loginAs('EMP000', '111111');
    cashierToken = await loginAs('EMP001', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: cat } = await admin.from('expense_categories')
      .select('id').eq('code', 'UTILITIES').single();
    utilitiesCategoryId = (cat as { id: string }).id;
  });

  it('cashier cannot create an expense (permission gate)', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('create_expense_v1', {
      p_category_id:    utilitiesCategoryId,
      p_amount:         100000,
      p_payment_method: 'cash',
      p_description:    'cashier-forbidden test',
      p_expense_date:   new Date().toISOString().slice(0, 10),
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/permission|forbidden|denied|42501/i);
  });

  it('full cycle: create -> submit -> approve -> JE balanced -> pay', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Create (admin EMP000). approve_expense_v3 verifies the CALLER's own PIN and
    //    blocks the creator from approving, so the creator must differ from the
    //    approver (EMP003, the only account whose PIN is known live). EMP000 is
    //    SUPER_ADMIN and has expenses.create.
    const sbAdm = jwtClient(adminToken);
    const sbMgr = jwtClient(managerToken);
    const idemKey = crypto.randomUUID();
    const { data: createId, error: cErr } = await sbAdm.rpc('create_expense_v1', {
      p_category_id:    utilitiesCategoryId,
      p_amount:         850000,
      p_payment_method: 'cash',
      p_description:    'live test electricity',
      p_expense_date:   today,
      p_idempotency_key: idemKey,
    });
    expect(cErr).toBeNull();
    expect(typeof createId).toBe('string');

    const expenseId = createId as unknown as string;

    // 2. Idempotency : same key returns same id.
    const { data: replayId } = await sbAdm.rpc('create_expense_v1', {
      p_category_id:    utilitiesCategoryId,
      p_amount:         999,
      p_payment_method: 'cash',
      p_description:    'replay (different vals)',
      p_expense_date:   today,
      p_idempotency_key: idemKey,
    });
    expect(replayId).toBe(expenseId);

    // 3. Submit (admin). submit_expense_v2 — p_idempotency_key is optional.
    const { error: sErr } = await sbAdm.rpc('submit_expense_v2', { p_expense_id: expenseId });
    expect(sErr).toBeNull();

    // 4. Approve (manager EMP003 — approve_expense_v3 verifies the caller's own PIN).
    const { data: approveData, error: aErr } = await sbMgr.rpc('approve_expense_v3', {
      p_expense_id:  expenseId,
      p_manager_pin: '111111',
    });
    expect(aErr).toBeNull();
    expect(approveData).toBeTruthy();

    const result = approveData as unknown as { status: string };
    expect(result.status).toBe('approved');

    // 5. Assert JE balanced. approve_expense_v3 no longer returns je_id, so look the
    //    entry up by its reference (reference_type='expense', reference_id=expense id).
    const { data: jeRow } = await admin.from('journal_entries').select('id, total_debit, total_credit')
      .eq('reference_type', 'expense').eq('reference_id', expenseId).single();
    const je = jeRow as unknown as JeRow;
    expect(Number(je.total_debit)).toBe(Number(je.total_credit));

    const { data: lines } = await admin.from('journal_entry_lines')
      .select('account_id, debit, credit').eq('journal_entry_id', je.id);
    expect(lines?.length).toBe(2);  // cash path : 2 lines.

    // 6. Pay (no extra JE since not credit).
    const { data: payData, error: pErr } = await sbAdm.rpc('pay_expense_v1', {
      p_expense_id: expenseId,
      p_payment_method: 'cash',
    });
    expect(pErr).toBeNull();
    const payRes = payData as unknown as { status: string; was_credit: boolean };
    expect(payRes.status).toBe('paid');
    expect(payRes.was_credit).toBe(false);
  });

  it('credit + VAT path emits 3-line JE and pay produces a 2nd JE', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const today = new Date().toISOString().slice(0, 10);

    // Creator (EMP000) must differ from the approver (EMP003) — see SOD note above.
    const sbAdm = jwtClient(adminToken);
    const sbMgr = jwtClient(managerToken);
    const { data: createId } = await sbAdm.rpc('create_expense_v1', {
      p_category_id:    utilitiesCategoryId,
      p_amount:         1100000,
      p_vat_amount:     100000,
      p_payment_method: 'credit',
      p_description:    'live test credit + VAT',
      p_expense_date:   today,
    });
    const expenseId = createId as unknown as string;

    await sbAdm.rpc('submit_expense_v2', { p_expense_id: expenseId });

    const { data: approveData } = await sbMgr.rpc('approve_expense_v3', {
      p_expense_id:  expenseId,
      p_manager_pin: '111111',
    });
    expect(approveData).toBeTruthy();

    // approve_expense_v3 no longer returns je_id — look it up by reference.
    const { data: jeRow } = await admin.from('journal_entries').select('id')
      .eq('reference_type', 'expense').eq('reference_id', expenseId).single();
    const jeId = (jeRow as { id: string }).id;

    const { data: lines } = await admin.from('journal_entry_lines')
      .select('debit, credit').eq('journal_entry_id', jeId);
    expect(lines?.length).toBe(3);

    const totalDebit  = (lines ?? []).reduce((s, l) => s + Number(l.debit),  0);
    const totalCredit = (lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);

    // Pay → expects 2nd JE.
    const { data: payData } = await sbAdm.rpc('pay_expense_v1', {
      p_expense_id: expenseId,
      p_payment_method: 'transfer',
    });
    const payRes = payData as unknown as { payment_je_id: string | null; was_credit: boolean };
    expect(payRes.was_credit).toBe(true);
    expect(payRes.payment_je_id).not.toBeNull();
  });
});
