// Deux connexions PostgREST rejouent une meme reception simultanement.
// Fixture propre a cette execution ; nettoyage par compensation, jamais par DELETE du ledger.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { jwtClient, loginAs, SERVICE_KEY, SUPABASE_URL } from './_helpers/auth';

describe.skipIf(!SERVICE_KEY)('stock mutation concurrent replay', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY || 'not-configured', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let token: string;
  let productId: string | undefined;

  beforeAll(async () => {
    if (new URL(SUPABASE_URL).hostname !== 'ikcyvlovptebroadgtvd.supabase.co') {
      throw new Error('Stock concurrency test requires the V3 dev project');
    }
    token = await loginAs('EMP000', '');
    const category = await admin.from('categories').select('id')
      .is('deleted_at', null).limit(1).single();
    expect(category.error).toBeNull();
    const fixture = await admin.from('products').insert({
      sku: `AUDIT-CONCURRENT-${randomUUID()}`,
      name: 'Stock concurrency test fixture',
      category_id: category.data!.id,
      retail_price: 0, cost_price: 0, current_stock: 0, unit: 'pcs', is_test: true,
    }).select('id').single();
    expect(fixture.error).toBeNull();
    productId = String(fixture.data!.id);
  });

  afterAll(async () => {
    if (!productId) return;
    const compensation = await jwtClient(token).rpc('adjust_stock_v2', {
      p_product_id: productId, p_new_qty: 0,
      p_reason: 'Concurrent stock test cleanup', p_idempotency_key: randomUUID(),
    });
    expect(compensation.error, 'Fixture compensation must succeed').toBeNull();
    const archived = await admin.from('products')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', productId).eq('is_test', true);
    expect(archived.error, 'Fixture archival must succeed').toBeNull();
  });

  it('creates one movement and returns one replay with the original result', async () => {
    const key = randomUUID();
    const args = {
      p_product_id: productId!, p_quantity: 7,
      p_reason: 'Concurrent receipt test', p_idempotency_key: key,
    };
    const [first, second] = await Promise.all([
      jwtClient(token).rpc('record_incoming_stock_v2', args),
      jwtClient(token).rpc('record_incoming_stock_v2', args),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const results = [first.data, second.data] as {
      movement_id: string; idempotent_replay: boolean; new_current_stock: number;
    }[];
    expect(results[0]!.movement_id).toBeTruthy();
    expect(results[0]!.movement_id).toBe(results[1]!.movement_id);
    expect(results.map(result => result.idempotent_replay).sort()).toEqual([false, true]);
    expect(results.map(result => Number(result.new_current_stock))).toEqual([7, 7]);
    const movements = await admin.from('stock_movements')
      .select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(movements.error).toBeNull();
    expect(movements.count).toBe(1);
    const product = await admin.from('products').select('current_stock').eq('id', productId!).single();
    expect(product.error).toBeNull();
    expect(Number(product.data!.current_stock)).toBe(7);
  });
});
