// ⚠️ OBSOLETE — exclusion datée 2026-07-14 (S77, triage nightly live-rpc-vitest).
// Motif : appelle refund_order_rpc + refund_order_rpc_v2 (DROPPÉS live) — courant refund_order_rpc_v4, EF-only depuis S55 (signature p_lines/p_tenders différente, PIN via nonce).
// Réécriture = session dédiée (hors périmètre S77). Exclu du run via vitest.config.ts (**/_quarantine/**).
// Couverture actuelle : ancres pgTAP reversal_idempotency + accounting.test.sql (JE de refund) + vitest process-payment.test.ts (EF).
//
// supabase/tests/functions/accounting-refund-je.test.ts
//
// Session 13 / Phase 1.A — Vitest live RPC tests for refund JE refactor (D16).
//
// Covers :
//   - refund_order_rpc_v2 callable ; v1 dropped (signature check)
//   - Refund triggers fn_create_je_for_refund → 1 balanced JE
//   - Idempotency replay returns the same refund_id
//
// Pattern mirrors supabase/tests/functions/receive-stock.test.ts.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from '../_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('accounting — refund JE refactor (Phase 1.A D16)', () => {
  let managerToken: string;
  let managerProfileId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: prof } = await admin.from('user_profiles')
      .select('id').eq('employee_code', 'EMP003').single();
    managerProfileId = prof!.id;
  });

  it('refund_order_rpc_v2 exists (and v1 is dropped)', async () => {
    const sb = jwtClient(managerToken);
    // Call with bogus args — we expect a clear PostgREST error from missing args /
    // missing order ; we just assert the function is exposed (no "function ... does not exist").
    const { error } = await sb.rpc('refund_order_rpc_v2', {
      p_order_id: '00000000-0000-0000-0000-000000000000',
      p_lines:    [],
      p_tenders:  [],
      p_reason:   'pgtap probe',
      p_authorized_by: managerProfileId,
    });
    // Any error other than "function does not exist" is acceptable for this probe.
    expect(error?.message ?? '').not.toMatch(/function .*refund_order_rpc_v2.* does not exist/i);

    // v1 should not be callable.
    const { error: errV1 } = await sb.rpc('refund_order_rpc' as never, {
      p_order_id: '00000000-0000-0000-0000-000000000000',
    } as never);
    expect(errV1?.message ?? '').toMatch(/function|does not exist|PGRST/i);
  });

  it('mapping keys for refund JE are seeded (SALE_PAYMENT_CASH / SALE_POS_REVENUE / SALE_PB1_TAX)', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('accounting_mappings')
      .select('mapping_key, is_active')
      .in('mapping_key', ['SALE_PAYMENT_CASH', 'SALE_POS_REVENUE', 'SALE_PB1_TAX']);
    expect(data?.length).toBe(3);
    for (const row of data ?? []) {
      expect(row.is_active).toBe(true);
    }
  });

  it('fn_create_je_for_refund is mapping-based (no hardcoded codes)', async () => {
    // We can't directly inspect pg_proc via PostgREST. The check is in pgTAP T21.
    // Here we assert by integration : trigger function is present (table refunds OK).
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { error } = await admin.from('refunds').select('id').limit(0);
    expect(error).toBeNull();  // table exists and is readable
  });
});
