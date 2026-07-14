// supabase/tests/functions/reports-audit.test.ts
// Session 13 / Phase 2.B — Live integration tests for get_audit_logs_v1.
//
// Coverage:
//   - Seeds N audit rows under a unique entity_type tag, then walks cursor
//     pages of 2, verifying the cursor contract (each page is strictly older
//     than the previous, page size respected, eventually empty).
//   - Server clamps p_limit > 200 down to 200.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const TEST_ENTITY = `phase2b_audit_${Date.now()}`;

interface AuditRow {
  id:          number;
  actor_id:    string | null;
  action:      string;
  entity_type: string;
  entity_id:   string | null;
  metadata:    unknown;
  created_at:  string;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('reports — audit cursor pagination (live)', () => {
  let adminToken: string;
  let adminProfileId: string;

  beforeAll(async () => {
    if (!SERVICE) {
      console.warn('[reports-audit.test] SUPABASE_SERVICE_ROLE_KEY missing — skipping live tests.');
      return;
    }
    adminToken = await loginAs('EMP000', '123456');

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: prof } = await admin.from('user_profiles').select('id')
      .eq('employee_code', 'EMP000').single();
    adminProfileId = prof!.id;

    // Seed 5 audit rows tagged with TEST_ENTITY (each row has a slightly
    // distinct created_at because we insert sequentially).
    for (let i = 0; i < 5; i++) {
      await admin.from('audit_logs').insert({
        actor_id:    adminProfileId,
        action:      'phase2b_test',
        entity_type: TEST_ENTITY,
        metadata:    { idx: i },
      });
      // Tiny gap so the timestamps are strictly increasing.
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'walks 3 cursor pages of 2 to cover all 5 seeded rows',
    async () => {
      const sb = jwtClient(adminToken);

      // Page 1
      const r1 = await sb.rpc('get_audit_logs_v1', {
        p_cursor: null, p_limit: 2, p_entity_type: TEST_ENTITY,
      });
      expect(r1.error).toBeNull();
      const page1 = (r1.data ?? []) as AuditRow[];
      expect(page1).toHaveLength(2);

      // Page 2 — cursor = last row of page 1
      const cursor1 = page1[1]?.created_at;
      const r2 = await sb.rpc('get_audit_logs_v1', {
        p_cursor: cursor1, p_limit: 2, p_entity_type: TEST_ENTITY,
      });
      expect(r2.error).toBeNull();
      const page2 = (r2.data ?? []) as AuditRow[];
      expect(page2).toHaveLength(2);
      // Strict ordering: each row of page 2 must be older than the cursor.
      for (const row of page2) {
        expect(new Date(row.created_at).getTime())
          .toBeLessThan(new Date(cursor1!).getTime());
      }

      // Page 3 — should have 1 row left, page 4 should be empty.
      const cursor2 = page2[1]?.created_at;
      const r3 = await sb.rpc('get_audit_logs_v1', {
        p_cursor: cursor2, p_limit: 2, p_entity_type: TEST_ENTITY,
      });
      expect(r3.error).toBeNull();
      const page3 = (r3.data ?? []) as AuditRow[];
      expect(page3).toHaveLength(1);

      const cursor3 = page3[0]?.created_at;
      const r4 = await sb.rpc('get_audit_logs_v1', {
        p_cursor: cursor3, p_limit: 2, p_entity_type: TEST_ENTITY,
      });
      expect(r4.error).toBeNull();
      expect((r4.data ?? []).length).toBe(0);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'clamps p_limit > 200 down to 200',
    async () => {
      const sb = jwtClient(adminToken);
      const { data, error } = await sb.rpc('get_audit_logs_v1', {
        p_cursor: null, p_limit: 99_999,
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as AuditRow[];
      expect(rows.length).toBeLessThanOrEqual(200);
    },
  );
});
