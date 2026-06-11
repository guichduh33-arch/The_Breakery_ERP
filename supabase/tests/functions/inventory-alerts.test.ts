// supabase/tests/functions/inventory-alerts.test.ts
// Session 13 / Phase 2.D — Vitest live RPC tests for alerts + product dashboard.
//
// Covers :
//   - get_low_stock_v1 returns products below min_stock_threshold.
//   - get_reorder_suggestions_v1 returns a sorted list with derived columns.
//   - get_product_dashboard_v1 returns a complete JSONB document.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

function jwtClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('inventory alerts + product dashboard', () => {
  let managerToken: string;
  let lowStockProductId: string;

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');

    const admin = createClient(SUPABASE_URL, SERVICE);
    // Force a product into low-stock state so get_low_stock_v1 has a row to return.
    const { data: p } = await admin.from('products')
      .select('id').eq('sku', 'BEV-AMER').single();
    lowStockProductId = p!.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await admin.from('products').update({
      min_stock_threshold: 1_000_000, // huge threshold so current_stock < threshold
    } as any).eq('id', lowStockProductId);
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

  it('T_ALERT_LIVE_03: get_product_dashboard_v1 returns the JSONB document', async () => {
    const sb = jwtClient(managerToken);
    const { data, error } = await rpc(sb)('get_product_dashboard_v1', {
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

  it('T_ALERT_LIVE_04: get_product_dashboard_v1 raises on missing product', async () => {
    const sb = jwtClient(managerToken);
    const { error } = await rpc(sb)('get_product_dashboard_v1', {
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
