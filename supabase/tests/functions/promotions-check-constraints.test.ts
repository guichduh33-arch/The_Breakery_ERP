import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Session 9 — DB-level CHECK constraints on the `promotions` table.
// Spec §3.1 — chk_promotion_type_fields, chk_promotion_date_range, chk_promotion_hour_range.
//
// All inserts run via the service role to bypass RLS — we want to exercise the
// CHECK constraints, not the RLS layer (covered separately in promotions-rls.test.ts).

const CHECK_VIOLATION = '23514';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('promotions table — CHECK constraints', () => {
  let admin: ReturnType<typeof createClient>;
  let beverageCategoryId: string;
  let croissantId: string;
  let americanoId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    const { data: cat } = await admin.from('categories').select('id').eq('slug', 'beverage').single();
    beverageCategoryId = cat!.id;

    const { data: croi } = await admin.from('products').select('id').eq('sku', 'PAS-CROI').single();
    croissantId = croi!.id;
    const { data: amer } = await admin.from('products').select('id').eq('sku', 'BEV-AMER').single();
    americanoId = amer!.id;
  });

  // ---------------------------------------------------------------------------
  // chk_promotion_type_fields — type-specific required columns.
  // ---------------------------------------------------------------------------
  describe('chk_promotion_type_fields', () => {
    it('rejects type=percentage without discount_value', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad pct no value', slug: `bad-pct-noval-${Date.now()}`,
        type: 'percentage', scope: 'cart',
        // discount_value omitted
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=percentage without scope', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad pct no scope', slug: `bad-pct-noscope-${Date.now()}`,
        type: 'percentage', discount_value: 10,
        // scope omitted
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=fixed_amount without discount_value', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad fixed', slug: `bad-fixed-${Date.now()}`,
        type: 'fixed_amount', scope: 'cart',
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=bogo with empty bogo_trigger_product_ids', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad bogo no trigger', slug: `bad-bogo-notrig-${Date.now()}`,
        type: 'bogo',
        bogo_trigger_product_ids: [],
        bogo_reward_product_ids: [croissantId],
        bogo_trigger_qty: 1,
        bogo_reward_qty: 1,
        bogo_reward_discount_pct: 100,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=bogo with empty bogo_reward_product_ids', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad bogo no reward', slug: `bad-bogo-norew-${Date.now()}`,
        type: 'bogo',
        bogo_trigger_product_ids: [americanoId],
        bogo_reward_product_ids: [],
        bogo_trigger_qty: 1,
        bogo_reward_qty: 1,
        bogo_reward_discount_pct: 100,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=bogo without bogo_reward_qty', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad bogo no rewqty', slug: `bad-bogo-norewqty-${Date.now()}`,
        type: 'bogo',
        bogo_trigger_product_ids: [americanoId],
        bogo_reward_product_ids: [croissantId],
        bogo_trigger_qty: 1,
        // bogo_reward_qty omitted
        bogo_reward_discount_pct: 100,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=bogo without bogo_reward_discount_pct', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad bogo no pct', slug: `bad-bogo-nopct-${Date.now()}`,
        type: 'bogo',
        bogo_trigger_product_ids: [americanoId],
        bogo_reward_product_ids: [croissantId],
        bogo_trigger_qty: 1,
        bogo_reward_qty: 1,
        // bogo_reward_discount_pct omitted
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects type=free_product without gift_product_id', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad free no gift', slug: `bad-free-${Date.now()}`,
        type: 'free_product',
        // gift_product_id omitted
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('accepts a valid percentage promotion', async () => {
      const slug = `valid-pct-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid pct', slug,
        type: 'percentage', scope: 'cart', discount_value: 5,
      });
      expect(error).toBeNull();
      // Cleanup so reseeding doesn't accumulate.
      await admin.from('promotions').delete().eq('slug', slug);
    });

    it('accepts a valid bogo promotion (all required fields)', async () => {
      const slug = `valid-bogo-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid bogo', slug,
        type: 'bogo',
        bogo_trigger_product_ids: [americanoId],
        bogo_reward_product_ids: [croissantId],
        bogo_trigger_qty: 2,
        bogo_reward_qty: 1,
        bogo_reward_discount_pct: 100,
      });
      expect(error).toBeNull();
      await admin.from('promotions').delete().eq('slug', slug);
    });

    it('accepts a valid free_product promotion', async () => {
      const slug = `valid-free-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid free', slug,
        type: 'free_product',
        gift_product_id: croissantId,
      });
      expect(error).toBeNull();
      await admin.from('promotions').delete().eq('slug', slug);
    });
  });

  // ---------------------------------------------------------------------------
  // chk_promotion_date_range — start_at must be < end_at when both set.
  // ---------------------------------------------------------------------------
  describe('chk_promotion_date_range', () => {
    it('rejects start_at > end_at', async () => {
      const start = new Date(Date.now() + 2 * 86400_000).toISOString();
      const end = new Date(Date.now() + 86400_000).toISOString();
      const { error } = await admin.from('promotions').insert({
        name: 'Bad date', slug: `bad-date-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: start, end_at: end,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects start_at = end_at (must be strictly less)', async () => {
      const t = new Date(Date.now() + 86400_000).toISOString();
      const { error } = await admin.from('promotions').insert({
        name: 'Bad date eq', slug: `bad-date-eq-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: t, end_at: t,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('accepts start_at < end_at', async () => {
      const start = new Date(Date.now() + 86400_000).toISOString();
      const end = new Date(Date.now() + 2 * 86400_000).toISOString();
      const slug = `valid-date-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid date', slug,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_at: start, end_at: end,
      });
      expect(error).toBeNull();
      await admin.from('promotions').delete().eq('slug', slug);
    });

    it('accepts NULL start_at + NULL end_at (open-ended)', async () => {
      const slug = `valid-noend-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid no dates', slug,
        type: 'percentage', scope: 'cart', discount_value: 5,
      });
      expect(error).toBeNull();
      await admin.from('promotions').delete().eq('slug', slug);
    });
  });

  // ---------------------------------------------------------------------------
  // chk_promotion_hour_range — both NULL OR both set with start < end.
  // ---------------------------------------------------------------------------
  describe('chk_promotion_hour_range', () => {
    it('rejects start_hour=20, end_hour=18 (inverted)', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad hour inv', slug: `bad-hour-inv-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: 20, end_hour: 18,
        scope_category_ids: [beverageCategoryId],
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects start_hour=18, end_hour=18 (equal)', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad hour eq', slug: `bad-hour-eq-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: 18, end_hour: 18,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects start_hour set without end_hour', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad hour no end', slug: `bad-hour-noend-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: 8,
        // end_hour omitted
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects end_hour set without start_hour', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad hour no start', slug: `bad-hour-nostart-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        end_hour: 18,
        // start_hour omitted
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('accepts both NULL (no hour filter)', async () => {
      const slug = `valid-hour-null-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid no hours', slug,
        type: 'percentage', scope: 'cart', discount_value: 5,
      });
      expect(error).toBeNull();
      await admin.from('promotions').delete().eq('slug', slug);
    });

    it('accepts start_hour=18, end_hour=20 (valid window)', async () => {
      const slug = `valid-hour-1820-${Date.now()}`;
      const { error } = await admin.from('promotions').insert({
        name: 'Valid 18-20', slug,
        type: 'percentage', scope: 'cart', discount_value: 10,
        start_hour: 18, end_hour: 20,
      });
      expect(error).toBeNull();
      await admin.from('promotions').delete().eq('slug', slug);
    });
  });

  // ---------------------------------------------------------------------------
  // Smaller column-level CHECKs.
  // ---------------------------------------------------------------------------
  describe('column-level CHECK constraints', () => {
    it('rejects negative discount_value', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad neg', slug: `bad-neg-disc-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: -5,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects bogo_reward_discount_pct > 100', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad pct over', slug: `bad-pct-over-${Date.now()}`,
        type: 'bogo',
        bogo_trigger_product_ids: [americanoId],
        bogo_reward_product_ids: [croissantId],
        bogo_trigger_qty: 1, bogo_reward_qty: 1,
        bogo_reward_discount_pct: 150,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects day_of_week_mask > 127', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad mask', slug: `bad-mask-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        day_of_week_mask: 200,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });

    it('rejects start_hour=24 (out of 0..23 range)', async () => {
      const { error } = await admin.from('promotions').insert({
        name: 'Bad hour 24', slug: `bad-hour-24-${Date.now()}`,
        type: 'percentage', scope: 'cart', discount_value: 5,
        start_hour: 24, end_hour: 25,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe(CHECK_VIOLATION);
    });
  });
});
