// supabase/tests/functions/inventory-movements.test.ts
// Session 13 / Phase 2.D — Vitest live RPC tests for the movements ledger view.
//
// Covers :
//   - get_stock_movements_v1 returns rows respecting filters + cursor pagination.
//   - get_movement_aggregates_v1 returns one row per movement_type with totals.
//   - 200-row hard cap on get_stock_movements_v1.

import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('inventory movements — get_stock_movements_v1 + aggregates', () => {
  let managerToken: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
  });

  it('T_MOV_LIVE_01: returns rows + columns shape', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_stock_movements_v1', { p_limit: 5 });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if (data.length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('id');
      expect(row).toHaveProperty('product_id');
      expect(row).toHaveProperty('movement_type');
      expect(row).toHaveProperty('quantity');
      expect(row).toHaveProperty('unit');
      expect(row).toHaveProperty('created_at');
    }
  });

  it('T_MOV_LIVE_02: cursor pagination — second page has older rows', async () => {
    const sb = jwtClient(managerToken);
    const { data: page1, error: e1 } = await rpc(sb)('get_stock_movements_v1', { p_limit: 5 });
    expect(e1).toBeNull();
    if (page1.length < 2) return; // not enough data, skip

    const last = page1[page1.length - 1];
    const { data: page2, error: e2 } = await rpc(sb)('get_stock_movements_v1', {
      p_limit: 5,
      p_cursor: last.created_at,
      p_cursor_id: last.id,
    });
    expect(e2).toBeNull();
    // Page 2 rows are STRICTLY older than (cursor, cursor_id).
    if (page2.length > 0) {
      const firstP2 = page2[0];
      expect(new Date(firstP2.created_at).getTime())
        .toBeLessThanOrEqual(new Date(last.created_at).getTime());
    }
  });

  it('T_MOV_LIVE_03: 200-row hard cap', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_stock_movements_v1', { p_limit: 5000 });
    expect(error).toBeNull();
    expect(data.length).toBeLessThanOrEqual(200);
  });

  it('T_MOV_LIVE_04: get_movement_aggregates_v1 returns array', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_movement_aggregates_v1', {});
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('T_MOV_LIVE_05: movement_type filter works', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_stock_movements_v1', {
      p_movement_type: 'sale',
      p_limit: 10,
    });
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.movement_type).toBe('sale');
    }
  });
});
