// supabase/tests/functions/reports-sales.test.ts
// Session 13 / Phase 2.B — Live integration tests for the sales-by-* RPCs.
//
// Coverage:
//   - get_sales_by_hour_v1 returns 24 zero-filled rows for today.
//   - get_sales_by_category_v3 runs and is non-error on a 7-day window.
//   - get_sales_by_staff_v3 runs and is non-error on a 7-day window.
//   - get_stock_variance_v3 (ADR-027 : démarque constatée, sans filtre
//     section) emits one row per tracked product with either a movement in
//     the default 30-day window or a non-zero current stock.
//
// Pattern mirrors `adjust-stock.test.ts`: PIN-login → JWT-bearing client → rpc().
// Requires env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY).

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('reports — sales RPCs (live)', () => {
  let adminToken: string;

  beforeAll(async () => {
    if (!SERVICE) {
      console.warn('[reports-sales.test] SUPABASE_SERVICE_ROLE_KEY missing — skipping live tests.');
      return;
    }
    adminToken = await loginAs('EMP000', '123456');
  });

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_sales_by_hour_v3 returns 24 zero-filled rows for today',
    async () => {
      const sb = jwtClient(adminToken);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_sales_by_hour_v3', { p_date: today });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      const rows = (data ?? []) as Array<{ hour: number; total: number; order_count: number }>;
      expect(rows).toHaveLength(24);
      expect(rows[0]?.hour).toBe(0);
      expect(rows[23]?.hour).toBe(23);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_sales_by_category_v3 runs on a 7-day window without error',
    async () => {
      const sb = jwtClient(adminToken);
      const end   = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_sales_by_category_v3', {
        p_date_start: start,
        p_date_end:   end,
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_sales_by_staff_v3 runs on a 7-day window without error',
    async () => {
      const sb = jwtClient(adminToken);
      const end   = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_sales_by_staff_v3', {
        p_date_start: start,
        p_date_end:   end,
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    // ADR-027 : la sémantique change avec la v3 — plus "un produit non
    // supprimé = une ligne", mais "un produit SUIVI avec, sur la fenêtre par
    // défaut (30j), soit un mouvement, soit un stock courant non nul". La
    // fenêtre est recalculée côté client (clock skew négligeable sur 30j).
    'get_stock_variance_v3 emits one row per tracked product with a movement in the window or a non-zero stock',
    async () => {
      const sb = jwtClient(adminToken);
      const { data, error } = await sb.rpc('get_stock_variance_v3', {});
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);

      const admin = createClient(SUPABASE_URL, SERVICE);
      const { data: products } = await admin.from('products')
        .select('id, current_stock')
        .is('deleted_at', null)
        .eq('track_inventory', true);

      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: movements } = await admin.from('stock_movements')
        .select('product_id')
        .gte('created_at', since);
      const movedProductIds = new Set((movements ?? []).map((m: { product_id: string }) => m.product_id));

      const expected = (products ?? []).filter((p: { id: string; current_stock: number }) =>
        movedProductIds.has(p.id) || Number(p.current_stock) !== 0,
      );

      const rows = (data ?? []) as unknown[];
      expect(rows.length).toBe(expected.length);
    },
  );
});
