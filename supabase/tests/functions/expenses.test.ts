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

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PIN_FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

async function loginAs(employeeCode: string, pin: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  await admin.from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null })
    .eq('employee_code', employeeCode);
  const { data: profile } = await admin.from('user_profiles')
    .select('id').eq('employee_code', employeeCode).single();
  if (!profile) throw new Error(`No profile for ${employeeCode}`);

  const res = await fetch(PIN_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
  });
  const body = await res.json();
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token as string;
}

function jwtClient(token: string) {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

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

    // 1. Create (manager).
    const sbMgr = jwtClient(managerToken);
    const idemKey = crypto.randomUUID();
    const { data: createId, error: cErr } = await sbMgr.rpc('create_expense_v1', {
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
    const { data: replayId } = await sbMgr.rpc('create_expense_v1', {
      p_category_id:    utilitiesCategoryId,
      p_amount:         999,
      p_payment_method: 'cash',
      p_description:    'replay (different vals)',
      p_expense_date:   today,
      p_idempotency_key: idemKey,
    });
    expect(replayId).toBe(expenseId);

    // 3. Submit.
    const { error: sErr } = await sbMgr.rpc('submit_expense_v1', { p_expense_id: expenseId });
    expect(sErr).toBeNull();

    // 4. Approve (admin).
    const sbAdm = jwtClient(adminToken);
    const { data: approveData, error: aErr } = await sbAdm.rpc('approve_expense_v1', {
      p_expense_id:     expenseId,
      p_approval_notes: 'looks good',
    });
    expect(aErr).toBeNull();
    expect(approveData).toBeTruthy();

    const result = approveData as unknown as { je_id: string; entry_number: string; status: string };
    expect(result.status).toBe('approved');

    // 5. Assert JE balanced.
    const { data: jeRow } = await admin.from('journal_entries').select('id, total_debit, total_credit')
      .eq('id', result.je_id).single();
    const je = jeRow as unknown as JeRow;
    expect(Number(je.total_debit)).toBe(Number(je.total_credit));

    const { data: lines } = await admin.from('journal_entry_lines')
      .select('account_id, debit, credit').eq('journal_entry_id', result.je_id);
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

    const sbMgr = jwtClient(managerToken);
    const { data: createId } = await sbMgr.rpc('create_expense_v1', {
      p_category_id:    utilitiesCategoryId,
      p_amount:         1100000,
      p_vat_amount:     100000,
      p_payment_method: 'credit',
      p_description:    'live test credit + VAT',
      p_expense_date:   today,
    });
    const expenseId = createId as unknown as string;

    await sbMgr.rpc('submit_expense_v1', { p_expense_id: expenseId });

    const sbAdm = jwtClient(adminToken);
    const { data: approveData } = await sbAdm.rpc('approve_expense_v1', {
      p_expense_id: expenseId,
    });
    const result = approveData as unknown as { je_id: string };

    const { data: lines } = await admin.from('journal_entry_lines')
      .select('debit, credit').eq('journal_entry_id', result.je_id);
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
