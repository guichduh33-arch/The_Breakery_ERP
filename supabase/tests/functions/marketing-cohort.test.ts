// supabase/tests/functions/marketing-cohort.test.ts
// Session 13 / Phase 6.B — Live integration test for
// `get_customer_cohort_v1` + `get_customer_segments_v1`.
//
// Pattern mirrors reports-sales.test.ts : PIN-login → JWT client → rpc().

import { describe, it, expect, beforeAll } from 'vitest';
import { loginAs, jwtClient } from './_helpers/auth';

const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('marketing — cohort + segments RPCs (live)', () => {
  let adminToken: string;

  beforeAll(async () => {
    if (!SERVICE) {
      console.warn('[marketing-cohort.test] SUPABASE_SERVICE_ROLE_KEY missing — skipping live tests.');
      return;
    }
    adminToken = await loginAs('EMP000', '123456');
  });

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_customer_cohort_v1 returns rows for the demo seed cohort',
    async () => {
      const sb = jwtClient(adminToken);
      const cohortMonth = '2026-01-01'; // any month with seed customers
      const { data, error } = await sb.rpc('get_customer_cohort_v1', {
        p_cohort_month:    cohortMonth,
        p_lookback_months: 6,
      });
      expect(error).toBeNull();
      // May be empty if no customers signed up in that month — accept any array.
      expect(Array.isArray(data)).toBe(true);
      const rows = (data ?? []) as Array<{
        cohort_month: string; months_since_signup: number;
        retained_customers: number; retention_pct: number;
      }>;
      // If any rows, month 0 must equal 100% retention by definition.
      if (rows.length > 0) {
        const month0 = rows.find((r) => r.months_since_signup === 0);
        expect(month0?.retention_pct).toBe(100);
      }
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_customer_cohort_v1 rejects lookback > 36',
    async () => {
      const sb = jwtClient(adminToken);
      const { data, error } = await sb.rpc('get_customer_cohort_v1', {
        p_cohort_month:    '2026-01-01',
        p_lookback_months: 99,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.code).toBe('22023');
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_customer_segments_v1 returns 6 buckets when p_segment_type=all',
    async () => {
      const sb = jwtClient(adminToken);
      const { data, error } = await sb.rpc('get_customer_segments_v1', {
        p_segment_type: 'all',
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{ segment: string; customer_count: number }>;
      expect(rows).toHaveLength(6);
      const codes = rows.map((r) => r.segment).sort();
      expect(codes).toEqual(['at_risk','champions','dormant','lost','loyal','new']);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_customer_segments_v1 returns 1 bucket when filtered by name',
    async () => {
      const sb = jwtClient(adminToken);
      const { data, error } = await sb.rpc('get_customer_segments_v1', {
        p_segment_type: 'lost',
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{ segment: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.segment).toBe('lost');
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_customer_segments_v1 rejects an unknown segment type',
    async () => {
      const sb = jwtClient(adminToken);
      const { data, error } = await sb.rpc('get_customer_segments_v1', {
        p_segment_type: 'whales',
      });
      expect(data).toBeNull();
      expect(error?.code).toBe('22023');
    },
  );
});
