// supabase/tests/functions/marketing-promo-roi.test.ts
// Session 13 / Phase 6.B — Live integration test for
// `get_promo_roi_v1`.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('marketing — promo ROI RPC (live)', () => {
  let adminToken: string;

  beforeAll(async () => {
    if (!SERVICE) {
      console.warn('[marketing-promo-roi.test] SUPABASE_SERVICE_ROLE_KEY missing — skipping live tests.');
      return;
    }
    adminToken = await loginAs('EMP000', '123456');
  });

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_promo_roi_v1 raises P0002 for an unknown promotion id',
    async () => {
      const sb = jwtClient(adminToken);
      const today = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.rpc('get_promo_roi_v1', {
        p_promotion_id: '00000000-0000-0000-0000-000000000000',
        p_date_start:   start,
        p_date_end:     today,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      // postgrest returns the code as "P0002".
      expect(error?.code).toBe('P0002');
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_promo_roi_v1 rejects inverted date range',
    async () => {
      const sb = jwtClient(adminToken);
      // We don't need a real promo id for this gate — it raises before the
      // not-found check fires.
      const { data, error } = await sb.rpc('get_promo_roi_v1', {
        p_promotion_id: '00000000-0000-0000-0000-000000000000',
        p_date_start:   '2026-05-30',
        p_date_end:     '2026-05-01',
      });
      expect(data).toBeNull();
      expect(error?.code).toBe('22023');
    },
  );

  it.runIf(!!process.env.SUPABASE_SERVICE_ROLE_KEY)(
    'get_promo_roi_v1 returns a zeroed jsonb for an unused promotion',
    async () => {
      const sb = jwtClient(adminToken);
      const admin = createClient(SUPABASE_URL, SERVICE);

      // Pick any existing active promo (seeded or otherwise).
      const { data: promos } = await admin
        .from('promotions')
        .select('id, slug, name')
        .is('deleted_at', null)
        .limit(1);
      if (!promos?.length) {
        console.warn('[marketing-promo-roi.test] No promotions in DB — skipping zero-roi case.');
        return;
      }
      const promoId = promos[0]!.id;

      // Use a far-future date range with no orders for that promo.
      const { data, error } = await sb.rpc('get_promo_roi_v1', {
        p_promotion_id: promoId,
        p_date_start:   '2099-01-01',
        p_date_end:     '2099-12-31',
      });
      expect(error).toBeNull();
      // RPC returns a jsonb scalar. supabase-js gives it back as parsed JSON.
      const roi = data as {
        promotion_id: string;
        redemptions: number;
        total_discount_given: number;
        roi_pct: number;
      };
      expect(roi.promotion_id).toBe(promoId);
      expect(roi.redemptions).toBe(0);
      expect(Number(roi.total_discount_given)).toBe(0);
      expect(Number(roi.roi_pct)).toBe(0);
    },
  );
});
