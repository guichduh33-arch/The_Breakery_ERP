import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe('session 7 — get_customer_product_price RPC + combo_items trigger', () => {
  let admin: ReturnType<typeof createClient>;
  let americanoId: string;
  let americanoRetailPrice: number;
  let croissantId: string;
  let comboId: string;
  let retailCategoryId: string;
  let vipCategoryId: string;
  let staffCategoryId: string;
  let wholesaleCategoryId: string;
  let customCategoryId: string;
  let walkinId: string;
  let goldId: string;
  let wholesaleCustomerId: string;
  let customCustomerId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE);

    const { data: products } = await admin
      .from('products')
      .select('id, sku, retail_price')
      .in('sku', ['BEV-AMER', 'PAS-CROI', 'COMBO-001']);
    if (!products?.length) throw new Error('Products not seeded — run supabase db reset');

    const amer    = products.find(p => p.sku === 'BEV-AMER')!;
    const croi    = products.find(p => p.sku === 'PAS-CROI')!;
    const combo   = products.find(p => p.sku === 'COMBO-001')!;
    americanoId        = amer.id;
    americanoRetailPrice = Number(amer.retail_price);
    croissantId        = croi.id;
    comboId            = combo.id;

    const { data: cats } = await admin
      .from('customer_categories')
      .select('id, slug');
    if (!cats?.length) throw new Error('customer_categories not seeded — run supabase db reset');

    retailCategoryId    = cats.find(c => c.slug === 'retail')!.id;
    vipCategoryId       = cats.find(c => c.slug === 'vip')!.id;
    staffCategoryId     = cats.find(c => c.slug === 'staff')!.id;
    wholesaleCategoryId = cats.find(c => c.slug === 'wholesale')!.id;
    customCategoryId    = cats.find(c => c.slug === 'custom')!.id;

    const { data: customers } = await admin
      .from('customers')
      .select('id, phone')
      .in('phone', ['+62811111111', '+62833333333']);
    walkinId = customers!.find(c => c.phone === '+62811111111')!.id;
    goldId   = customers!.find(c => c.phone === '+62833333333')!.id;

    await admin.from('customers').update({ category_id: retailCategoryId }).eq('id', walkinId);

    const { data: ws } = await admin.from('customers')
      .insert({ name: 'Wholesale Test', phone: '+62899000001', category_id: wholesaleCategoryId })
      .select('id').single();
    wholesaleCustomerId = ws!.id;

    const { data: cc } = await admin.from('customers')
      .insert({ name: 'Custom Test', phone: '+62899000002', category_id: customCategoryId })
      .select('id').single();
    customCustomerId = cc!.id;

    await admin.from('products').update({ wholesale_price: null }).eq('id', americanoId);
  });

  describe('get_customer_product_price — null customer', () => {
    it('returns retail_price when p_customer_id IS NULL', async () => {
      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id: americanoId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(americanoRetailPrice);
    });
  });

  describe('get_customer_product_price — retail category', () => {
    it('returns retail_price for retail category', async () => {
      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: walkinId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(americanoRetailPrice);
    });
  });

  describe('get_customer_product_price — wholesale category', () => {
    it('returns wholesale_price when product has it set', async () => {
      const ws = 28000;
      await admin.from('products').update({ wholesale_price: ws }).eq('id', americanoId);

      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: wholesaleCustomerId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(ws);

      await admin.from('products').update({ wholesale_price: null }).eq('id', americanoId);
    });

    it('falls back to retail_price when wholesale_price IS NULL', async () => {
      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: wholesaleCustomerId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(americanoRetailPrice);
    });
  });

  describe('get_customer_product_price — discount_percentage category', () => {
    it('VIP 5% discount returns round_idr(retail * 0.95)', async () => {
      const expected = Math.round((americanoRetailPrice * 0.95) / 50) * 50;
      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: goldId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(expected);
    });

    it('Staff 15% discount returns round_idr(retail * 0.85)', async () => {
      const { data: staffCustomer } = await admin.from('customers')
        .insert({ name: 'Staff Test', phone: '+62899000003', category_id: staffCategoryId })
        .select('id').single();

      const expected = Math.round((americanoRetailPrice * 0.85) / 50) * 50;
      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: staffCustomer!.id,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(expected);

      await admin.from('customers').delete().eq('id', staffCustomer!.id);
    });
  });

  describe('get_customer_product_price — custom category', () => {
    it('returns custom price when product_category_prices entry exists', async () => {
      const customPrice = 30000;
      await admin.from('product_category_prices').upsert({
        product_id:           americanoId,
        customer_category_id: customCategoryId,
        price:                customPrice,
      });

      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: customCustomerId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(customPrice);

      await admin.from('product_category_prices')
        .delete()
        .eq('product_id', americanoId)
        .eq('customer_category_id', customCategoryId);
    });

    it('falls back to retail_price when no product_category_prices entry', async () => {
      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: customCustomerId,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(americanoRetailPrice);
    });
  });

  describe('get_customer_product_price — null category_id resolves to default', () => {
    it('customer with NULL category_id uses is_default category (Retail → retail_price)', async () => {
      const { data: nc } = await admin.from('customers')
        .insert({ name: 'No Category', phone: '+62899000004' })
        .select('id').single();

      const { data, error } = await admin.rpc('get_customer_product_price', {
        p_product_id:  americanoId,
        p_customer_id: nc!.id,
      });
      expect(error).toBeNull();
      expect(Number(data)).toBe(americanoRetailPrice);

      await admin.from('customers').delete().eq('id', nc!.id);
    });
  });

  describe('get_customer_product_price — product not found', () => {
    it('raises no_data_found for non-existent product_id', async () => {
      const { error } = await admin.rpc('get_customer_product_price', {
        p_product_id: '00000000-dead-beef-dead-000000000000',
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('PGRST202');
    });
  });

  describe('combo_items trigger — enforce_combo_parent_type', () => {
    it('rejects INSERT when parent product_type is not combo', async () => {
      const { error } = await admin.from('combo_items').insert({
        parent_product_id:    americanoId,
        component_product_id: croissantId,
        quantity:             1,
        sort_order:           0,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23000');
    });

    it('rejects INSERT when component product_type is combo (no nested combos)', async () => {
      const { data: nestedCombo } = await admin.from('products').insert({
        sku:          'COMBO-NESTED-TEST',
        name:         'Nested Test Combo',
        category_id:  '11111111-1111-1111-1111-111111111111',
        retail_price: 10000,
        product_type: 'combo',
      }).select('id').single();

      const { error } = await admin.from('combo_items').insert({
        parent_product_id:    comboId,
        component_product_id: nestedCombo!.id,
        quantity:             1,
        sort_order:           0,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23000');

      await admin.from('products').delete().eq('id', nestedCombo!.id);
    });

    it('succeeds when parent is combo and component is finished', async () => {
      const { data: existingItems } = await admin.from('combo_items')
        .select('component_product_id')
        .eq('parent_product_id', comboId);

      const { data: freshFinished } = await admin.from('products').insert({
        sku:          'FINISHED-TRIGGER-TEST',
        name:         'Trigger Test Finished',
        category_id:  '11111111-1111-1111-1111-111111111111',
        retail_price: 5000,
        product_type: 'finished',
      }).select('id').single();

      const { error } = await admin.from('combo_items').insert({
        parent_product_id:    comboId,
        component_product_id: freshFinished!.id,
        quantity:             1,
        sort_order:           99,
      });
      expect(error).toBeNull();

      await admin.from('combo_items')
        .delete()
        .eq('parent_product_id', comboId)
        .eq('component_product_id', freshFinished!.id);
      await admin.from('products').delete().eq('id', freshFinished!.id);
    });
  });
});
