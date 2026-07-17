// supabase/tests/functions/reports-financials.test.ts
// Session 13 / Phase 6.A — Live integration tests for the financial /
// market-basket report RPCs (get_profit_loss_v1, get_balance_sheet_v1,
// get_cash_flow_v1, get_basket_analysis_v2).
//
// Coverage:
//   - All 4 RPCs callable as an authenticated admin.
//   - get_profit_loss_v1 returns the expected JSON shape on a 30-day window.
//   - get_balance_sheet_v1 returns balanced = true on staging (no posted
//     manual JEs other than seeded ones; if the staging happens to be
//     unbalanced from old test data, we still verify the field exists).
//   - get_cash_flow_v1 returns investing.total = 0 and financing.total = 0
//     (MVP placeholders, D-W6-6A-2).
//   - get_basket_analysis_v2 returns an array on a 30-day window.
//
// Pattern mirrors `reports-sales.test.ts`: PIN-login → JWT-bearing client → rpc().
// Requires env vars: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY).

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('reports — financial RPCs (live)', () => {
  let adminToken: string;

  beforeAll(async () => {
    if (!SERVICE) {
      console.warn('[reports-financials.test] SUPABASE_SERVICE_ROLE_KEY missing — skipping live tests.');
      return;
    }
    adminToken = await loginAs('EMP000', '123456');
  });

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_profit_loss_v2 returns the expected JSON shape for a 30-day window',
    async () => {
      const sb = jwtClient(adminToken);
      const end   = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_profit_loss_v2', {
        p_date_start: start,
        p_date_end:   end,
      });
      expect(error).toBeNull();
      expect(data).toBeTypeOf('object');
      const d = data as Record<string, unknown>;
      expect(d).toHaveProperty('revenue');
      expect(d).toHaveProperty('cogs');
      expect(d).toHaveProperty('opex');
      expect(d).toHaveProperty('gross_profit');
      expect(d).toHaveProperty('net_profit');
      expect(d).toHaveProperty('lines');
      expect(d).toHaveProperty('period');
      // Math invariant: net_profit = revenue.total - cogs.total - opex.total
      const rev = Number((d.revenue as Record<string, unknown>).total);
      const cog = Number((d.cogs    as Record<string, unknown>).total);
      const op  = Number((d.opex    as Record<string, unknown>).total);
      const net = Number(d.net_profit);
      expect(Math.abs(net - (rev - cog - op))).toBeLessThan(0.01);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_balance_sheet_v2 returns balanced shape + computes CYE',
    async () => {
      const sb = jwtClient(adminToken);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_balance_sheet_v2', {
        p_as_of_date: today,
      });
      expect(error).toBeNull();
      expect(data).toBeTypeOf('object');
      const d = data as Record<string, unknown>;
      expect(d).toHaveProperty('assets');
      expect(d).toHaveProperty('liabilities');
      expect(d).toHaveProperty('equity');
      expect(d).toHaveProperty('balanced');
      expect(d).toHaveProperty('delta');
      const eq = d.equity as Record<string, unknown>;
      expect(eq).toHaveProperty('current_year_earnings');
      // Balanced math: assets.total = liabilities.total + equity.total within 0.01
      const A = Number((d.assets      as Record<string, unknown>).total);
      const L = Number((d.liabilities as Record<string, unknown>).total);
      const E = Number(eq.total);
      expect(Math.abs(A - (L + E))).toBeLessThan(0.01);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_cash_flow_v1 returns investing=0 and financing=0 (MVP placeholders)',
    async () => {
      const sb = jwtClient(adminToken);
      const end   = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_cash_flow_v1', {
        p_date_start: start,
        p_date_end:   end,
      });
      expect(error).toBeNull();
      const d = data as Record<string, unknown>;
      expect(d).toHaveProperty('operating');
      expect(d).toHaveProperty('investing');
      expect(d).toHaveProperty('financing');
      expect(d).toHaveProperty('net_change_in_cash');
      expect(Number((d.investing as Record<string, unknown>).total)).toBe(0);
      expect(Number((d.financing as Record<string, unknown>).total)).toBe(0);
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_basket_analysis_v2 returns an array on a 30-day window',
    async () => {
      const sb = jwtClient(adminToken);
      const end   = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_basket_analysis_v2', {
        p_date_start: start,
        p_date_end:   end,
        p_top_n:      5,
      });
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    },
  );
});
