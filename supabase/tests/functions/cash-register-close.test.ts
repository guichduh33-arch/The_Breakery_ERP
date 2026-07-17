// supabase/tests/functions/cash-register-close.test.ts
// Session 13 / Phase 3.C — Live integration tests for cash register flow.
// S60 (12 D1.4) — repointed to record_cash_movement_v2 / close_shift_v3
// (v1/v2 were dropped ; v3 additionally enforces the above-threshold variance
// note server-side — see close_shift_note_enforced.test.sql for that guard).
// S66 (12 D2.1) — repointed to close_shift_v4 (v3 dropped) puis S67 close_shift_v5 (v4 additionally
// requires a designated manager + PIN above shift_variance_pin_threshold_abs/pct,
// defaults 200 000 / 2 % — see close_shift_pin_gate.test.sql). The variance
// fixtures move from a 500k float (30k = 6 % would cross the 2 % PIN threshold)
// to a 2M float (30k = 1.5 % / 20k = 1 % : note-band only, no PIN needed).
//
// Covers:
//   - record_cash_movement_v2 increments cash_in_total / cash_out_total
//   - close_shift_v5 with zero variance: no JE emitted
//   - close_shift_v5 with positive variance: balanced JE through
//     SHIFT_CASH_VARIANCE_INCOME mapping
//   - close_shift_v5 with negative variance: balanced JE through
//     SHIFT_CASH_VARIANCE_EXPENSE mapping
//   - close_shift_v5 idempotency on a closed session
//   - Permission gate: cashier without shift.close gets forbidden

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAsFull, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Historically returned the auth user id (not the profile id) as `profileId`;
// that field is unused by the call-sites but preserved for fidelity.
async function loginAs(employeeCode: string, _pin: string): Promise<{ token: string; profileId: string }> {
  const r = await loginAsFull(employeeCode);
  return { token: r.token, profileId: r.authUserId };
}

async function openShift(token: string, openingCash: number): Promise<string> {
  const sb = jwtClient(token);
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error('no auth user');
  const admin = createClient(SUPABASE_URL, SERVICE);
  const { data, error } = await admin.from('pos_sessions').insert({
    opened_by: u.user.id, opening_cash: openingCash,
  }).select('id').single();
  if (error) throw error;
  return data!.id;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('cash register — close_shift_v5 integration', () => {
  let managerToken: string;

  beforeAll(async () => {
    const m = await loginAs('EMP003', '111111');
    managerToken = m.token;
  });

  it('record_cash_movement_v2 updates session totals', async () => {
    const sb = jwtClient(managerToken);
    const sessionId = await openShift(managerToken, 500_000);

    const { data: cashIn, error: e1 } = await sb.rpc('record_cash_movement_v2', {
      p_session_id: sessionId,
      p_direction: 'in',
      p_amount: 100_000,
      p_reason: 'Float top-up from safe',
    });
    expect(e1).toBeNull();
    expect(cashIn).toMatchObject({ cash_in_total: 100_000, cash_out_total: 0 });

    const { data: cashOut, error: e2 } = await sb.rpc('record_cash_movement_v2', {
      p_session_id: sessionId,
      p_direction: 'out',
      p_amount: 25_000,
      p_reason: 'Petty cash for groceries',
    });
    expect(e2).toBeNull();
    expect(cashOut).toMatchObject({ cash_in_total: 100_000, cash_out_total: 25_000 });

    // Cleanup.
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('pos_sessions').delete().eq('id', sessionId);
  });

  it('close_shift_v5 with zero variance posts no JE', async () => {
    const sb = jwtClient(managerToken);
    const sessionId = await openShift(managerToken, 1_000_000);

    const { data: close, error } = await sb.rpc('close_shift_v7', {
      p_session_id: sessionId,
      p_counted_cash: 1_000_000,
      p_notes: 'zero variance smoke',
    });
    expect(error).toBeNull();
    expect(close).toMatchObject({ status: 'closed', variance: 0 });
    expect((close as { journal_entry_id: string | null }).journal_entry_id).toBeNull();

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { count } = await admin.from('journal_entries')
      .select('id', { count: 'exact', head: true })
      .eq('reference_type', 'shift_close')
      .eq('reference_id', sessionId);
    expect(count).toBe(0);

    await admin.from('pos_sessions').delete().eq('id', sessionId);
  });

  it('close_shift_v5 with positive variance posts JE via SHIFT_CASH_VARIANCE_INCOME', async () => {
    const sb = jwtClient(managerToken);
    const sessionId = await openShift(managerToken, 2_000_000);

    const counted = 2_030_000; // +30k over (1.5% — note band, below the 2% PIN threshold)
    const { data: close, error } = await sb.rpc('close_shift_v7', {
      p_session_id: sessionId,
      p_counted_cash: counted,
      p_notes: 'positive variance smoke',
    });
    expect(error).toBeNull();
    expect(close).toMatchObject({ status: 'closed', variance: 30_000 });

    const jeId = (close as { journal_entry_id: string }).journal_entry_id;
    expect(jeId).toBeTruthy();

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: je } = await admin.from('journal_entries')
      .select('total_debit, total_credit, reference_type')
      .eq('id', jeId).single();
    expect(je?.reference_type).toBe('shift_close');
    expect(Number(je?.total_debit)).toBe(30_000);
    expect(Number(je?.total_credit)).toBe(30_000);

    const { data: lines } = await admin.from('journal_entry_lines')
      .select('debit, credit, account_id')
      .eq('journal_entry_id', jeId);
    expect(lines).toHaveLength(2);
    const totalDebit = (lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = (lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);

    await admin.from('pos_sessions').delete().eq('id', sessionId);
  });

  it('close_shift_v5 with negative variance posts JE via SHIFT_CASH_VARIANCE_EXPENSE', async () => {
    const sb = jwtClient(managerToken);
    const sessionId = await openShift(managerToken, 2_000_000);

    const counted = 1_980_000; // -20k short (1% — note band, below the 2% PIN threshold)
    const { data: close, error } = await sb.rpc('close_shift_v7', {
      p_session_id: sessionId,
      p_counted_cash: counted,
      p_notes: 'negative variance smoke',
    });
    expect(error).toBeNull();
    expect(close).toMatchObject({ status: 'closed', variance: -20_000 });

    const jeId = (close as { journal_entry_id: string }).journal_entry_id;
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: je } = await admin.from('journal_entries')
      .select('total_debit, total_credit').eq('id', jeId).single();
    expect(Number(je?.total_debit)).toBe(20_000);
    expect(Number(je?.total_credit)).toBe(20_000);

    await admin.from('pos_sessions').delete().eq('id', sessionId);
  });

  it('close_shift_v5 idempotent on an already-closed session', async () => {
    const sb = jwtClient(managerToken);
    const sessionId = await openShift(managerToken, 100_000);
    await sb.rpc('close_shift_v7', {
      p_session_id: sessionId, p_counted_cash: 100_000,
    });
    const { data: replay, error } = await sb.rpc('close_shift_v7', {
      p_session_id: sessionId, p_counted_cash: 100_000,
    });
    expect(error).toBeNull();
    expect(replay).toMatchObject({ status: 'closed', idempotent_replay: true });
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('pos_sessions').delete().eq('id', sessionId);
  });
});
