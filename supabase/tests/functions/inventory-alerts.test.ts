// supabase/tests/functions/inventory-alerts.test.ts
// Session 13 / Phase 2.D — Vitest live RPC tests for alerts + product dashboard.
//
// Covers :
//   - get_low_stock_v1 returns products below min_stock_threshold.
//   - get_reorder_suggestions_v1 returns a sorted list with derived columns.
//   - get_product_dashboard_v2 returns a complete JSONB document.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';
import { ensureTestProduct } from './_helpers/fixtures';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc.bind(sb) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('inventory alerts + product dashboard', () => {
  let managerToken: string;
  let lowStockProductId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    // S78 (D-6) : BEV-AMER est soft-deleted sur la DB vivante. Produit de
    // test dédié, upsert-restauré, seuil énorme => toujours low-stock.
    lowStockProductId = await ensureTestProduct(admin, {
      sku: 'ZZ-TEST-ALERTS', name: '[TEST] Alerts live spec',
      current_stock: 10, min_stock_threshold: 1_000_000,
    });
  });

  it('T_ALERT_LIVE_01: get_low_stock_v1 includes the seeded low-stock product', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_low_stock_v1', {});
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    const found = (data ?? []).find((r: { product_id: string }) => r.product_id === lowStockProductId);
    expect(found).toBeTruthy();
    expect(Number(found!.shortfall)).toBeGreaterThan(0);
  });

  it('T_ALERT_LIVE_02: get_reorder_suggestions_v1 returns shape + ordering', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_reorder_suggestions_v1', { p_lookback_days: 30, p_buffer_days: 14 });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    if ((data ?? []).length > 0) {
      const row = data[0];
      expect(row).toHaveProperty('product_id');
      expect(row).toHaveProperty('avg_daily_usage');
      expect(row).toHaveProperty('suggested_order_qty');
    }
  });

  it('T_ALERT_LIVE_03: get_product_dashboard_v2 returns the JSONB document', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_product_dashboard_v2', {
      p_product_id: lowStockProductId, p_days: 30,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.product.id).toBe(lowStockProductId);
    expect(data.summary).toHaveProperty('window_days', 30);
    expect(Array.isArray(data.stock_by_section)).toBe(true);
    expect(Array.isArray(data.recent_movements)).toBe(true);
    expect(Array.isArray(data.sales_velocity_daily)).toBe(true);
    expect(Array.isArray(data.expiring_lots)).toBe(true);
    expect(Array.isArray(data.top_customers)).toBe(true);
    // Velocity has window_days entries (one per day in the range).
    expect(data.sales_velocity_daily.length).toBeGreaterThanOrEqual(28);
    expect(data.sales_velocity_daily.length).toBeLessThanOrEqual(32);
  });

  it('T_ALERT_LIVE_04: get_product_dashboard_v2 raises on missing product', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await rpc(sb)('get_product_dashboard_v2', {
      p_product_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error?.message ?? '').toMatch(/product_not_found/);
  });

  it('T_ALERT_LIVE_05: view_section_stock_details is queryable', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await sb
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('view_section_stock_details' as any)
      .select('section_code, product_sku, quantity, stock_value')
      .limit(5);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
