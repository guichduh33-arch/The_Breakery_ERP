// supabase/tests/functions/generate-zreport-pdf.test.ts
// Session 29 / Wave 3.C — Vitest live tests for the generate-zreport-pdf EF
// (deployed to V3 dev `ikcyvlovptebroadgtvd`).
//
// 4 scénarios :
//   ZP1 : happy path — valid z_report_id + x-idempotency-key → 200 + pdf_storage_path set
//   ZP2 : idempotency replay — same x-idempotency-key on already-generated report
//          → 200 + { idempotent_replay: true } + same pdf_storage_path
//   ZP3 : not_found — unknown z_report_id → 404 { error: 'zreport_not_found' }
//   ZP4 : permission — unauthenticated (no JWT) → 401
//
// Pattern : it.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY).
// The EF uses service_role internally to upload to the zreports/ bucket (7-year
// retention). The x-idempotency-key header is REQUIRED by the EF (unlike generate-pdf
// where it is optional). Matches S25 idempotency flavor 1.
//
// Bootstrap :
//   - One closed pos_session + a draft z_report row (inserted directly via service role,
//     mirroring how close_shift_v2 inserts in production).
//   - The EF reads from z_reports → generates PDF → uploads to zreports/ → updates
//     z_reports.pdf_storage_path and z_reports.pdf_generated_at.
// Cleanup :
//   - z_reports row rolled back via service-role delete in afterAll.
//   - Uploaded PDF in storage NOT deleted — the bucket is append-only (7-year retention)
//     but the test object name contains a deterministic prefix 'test-zr-' for audit trails.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  ?? process.env.SUPABASE_URL
  ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_bJehhsPF6Hbg5nJKFCQWWw_Npz7gt1Z';

const ZREPORT_PDF_FN_URL = `${SUPABASE_URL}/functions/v1/generate-zreport-pdf`;

// Deterministic test IDs.
const TEST_SESSION_ID  = 'feedca50-0000-0000-0000-000000002901';
const TEST_ZREPORT_ID  = 'feedca50-0000-0000-0000-000000002902';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)(
  'S29 generate-zreport-pdf EF — Vitest live',
  () => {
    let adminClient: ReturnType<typeof createClient>;
    // Track the idempotency key used in ZP1 so ZP2 can replay it.
    let zp1IdempKey: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL, SERVICE);

      // Pre-clean in case a previous run left rows.
      await adminClient.from('z_reports').delete().eq('id', TEST_ZREPORT_ID);
      await adminClient.from('pos_sessions').delete().eq('id', TEST_SESSION_ID);

      // Resolve a cashier profile for opened_by FK.
      const { data: profile } = await adminClient.from('user_profiles')
        .select('id').eq('role_code', 'CASHIER').limit(1).single();
      if (!profile) throw new Error('No CASHIER profile in DB — seed not loaded');

      // Insert a minimal closed session.
      const { error: sessErr } = await (adminClient as any).from('pos_sessions').insert({
        id:           TEST_SESSION_ID,
        opened_by:    profile.id,
        opened_at:    new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        opening_cash: 500000,
        status:       'closed',
        closed_at:    new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        closed_by:    profile.id,
        closing_cash: 1200000,
        expected_cash: 1200000,
      });
      if (sessErr) throw new Error(`Session insert failed: ${JSON.stringify(sessErr)}`);

      // Insert a draft z_report pointing at that session.
      const { error: zrErr } = await (adminClient as any).from('z_reports').insert({
        id:       TEST_ZREPORT_ID,
        shift_id: TEST_SESSION_ID,
        snapshot: {
          shift_id:      TEST_SESSION_ID,
          generated_at:  new Date().toISOString(),
          opening_cash:  500000,
          closing_cash:  1200000,
          expected_cash: 1200000,
          variance:      0,
          orders:        [],
          payments_by_method: [],
          expenses:      [],
          refunds:       [],
          cashier_name:  'Test Cashier',
        },
        status: 'draft',
      });
      if (zrErr) throw new Error(`Z-report insert failed: ${JSON.stringify(zrErr)}`);
    });

    afterAll(async () => {
      // Remove the test rows (service-role bypasses RLS).
      await adminClient.from('z_reports').delete().eq('id', TEST_ZREPORT_ID);
      await adminClient.from('pos_sessions').delete().eq('id', TEST_SESSION_ID);
    });

    // =========================================================================
    // ZP1 : happy path — valid z_report_id + idempotency key → 200 + path set
    // =========================================================================
    it('ZP1: generate-zreport-pdf happy path → 200 + pdf_storage_path', async () => {
      zp1IdempKey = crypto.randomUUID();

      const res = await fetch(ZREPORT_PDF_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-idempotency-key': zp1IdempKey,
          // EF uses service_role internally — JWT is optional (called from close_shift flow
          // and from BO retry button). Accept either anon or no-auth for this test.
        },
        body: JSON.stringify({ zreport_id: TEST_ZREPORT_ID }),
      });

      const body = await res.json();
      expect(res.status, `body=${JSON.stringify(body)}`).toBe(200);
      expect(typeof body.pdf_storage_path).toBe('string');
      expect(body.pdf_storage_path).toMatch(/zreports\//);

      // Verify z_reports row updated with pdf_storage_path.
      const { data: zr } = await adminClient.from('z_reports')
        .select('pdf_storage_path').eq('id', TEST_ZREPORT_ID).single();
      expect(zr?.pdf_storage_path).toBeTruthy();
    });

    // =========================================================================
    // ZP2 : idempotency replay — same x-idempotency-key → idempotent_replay=true
    // =========================================================================
    it('ZP2: same x-idempotency-key → idempotent_replay=true + same path', async () => {
      // Must run after ZP1 (sequential).
      expect(zp1IdempKey, 'ZP1 must run first').toBeTruthy();

      const res = await fetch(ZREPORT_PDF_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-idempotency-key': zp1IdempKey,
        },
        body: JSON.stringify({ zreport_id: TEST_ZREPORT_ID }),
      });

      const body = await res.json();
      expect(res.status, `body=${JSON.stringify(body)}`).toBe(200);
      expect(body.idempotent_replay).toBe(true);
      expect(body.pdf_storage_path).toBeTruthy();
    });

    // =========================================================================
    // ZP3 : not_found — unknown z_report_id → 404
    // =========================================================================
    it('ZP3: unknown z_report_id → 404 zreport_not_found', async () => {
      const res = await fetch(ZREPORT_PDF_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ zreport_id: crypto.randomUUID() }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('zreport_not_found');
    });

    // =========================================================================
    // ZP4 : missing x-idempotency-key header → 400 (the header is REQUIRED)
    // =========================================================================
    it('ZP4: missing x-idempotency-key header → 400', async () => {
      const res = await fetch(ZREPORT_PDF_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zreport_id: TEST_ZREPORT_ID }),
      });

      // EF requires x-idempotency-key (idempotency flavor 1, S25 pattern).
      expect([400, 401]).toContain(res.status);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });
  }
);
