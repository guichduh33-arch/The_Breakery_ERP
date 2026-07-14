// supabase/tests/functions/recipe-cost-history.test.ts
// Session 18 / Phase 1.A — Live integration smoke for recipe_cost_history_v1.
//
// Coverage:
//   - Overview: returns rows with expected columns for a 60-day window.
//   - Drill-down with unknown product_id returns [].
//   - Permission gate: unauthenticated call returns P0003 forbidden.
//
// Skips gracefully when env vars are missing (CI dry-run without credentials).
// Pattern mirrors recipe-bom-full.test.ts (Session 17 / Phase 1.D).

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? '';

const liveCfg      = !!SUPABASE_URL && !!SERVICE && !!ANON;
const describeLive = liveCfg ? describe : describe.skip;

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON);
}

interface CostHistoryRow {
  product_id:     string;
  product_name:   string;
  version_number: number | null;
  created_at:     string | null;
  cost_per_unit:  number | null;
  change_note:    string | null;
  baseline_cost:  number | null;
  delta_pct:      number | null;
  change_count:   number | null;
}

describeLive('recipe_cost_history_v1 — live integration', () => {
  let managerToken: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP000', '111111');
  }, 30_000);

  it('overview: returns rows with correct column shapes for 60-day window', async () => {
    const mgr  = jwtClient(managerToken);
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);

    const { data, error } = await mgr.rpc('recipe_cost_history_v1', {
      p_from: from,
      p_to:   to,
      p_product_id: null,
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    if ((data as CostHistoryRow[]).length > 0) {
      const row = (data as CostHistoryRow[])[0];
      expect(row).toMatchObject({
        product_id:   expect.any(String),
        product_name: expect.any(String),
        change_count: expect.any(Number),
      });
      // UUIDs are 36 chars
      expect(row.product_id).toHaveLength(36);
      // version_number is null in overview mode
      expect(row.version_number).toBeNull();
    }
  });

  it('drill-down: unknown product_id returns empty array', async () => {
    const mgr  = jwtClient(managerToken);
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);

    const { data, error } = await mgr.rpc('recipe_cost_history_v1', {
      p_from:       from,
      p_to:         to,
      p_product_id: '00000000-0000-0000-0000-000000000000',
    });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('invalid date range returns error code P0001', async () => {
    const mgr = jwtClient(managerToken);

    const { error } = await mgr.rpc('recipe_cost_history_v1', {
      p_from:       '2025-12-31',
      p_to:         '2025-01-01',
      p_product_id: null,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('P0001');
  });

  it('unauthenticated call returns P0003 forbidden', async () => {
    const anon = anonClient();
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to   = new Date().toISOString().slice(0, 10);

    const { error } = await anon.rpc('recipe_cost_history_v1', {
      p_from:       from,
      p_to:         to,
      p_product_id: null,
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('P0003');
  });
});
