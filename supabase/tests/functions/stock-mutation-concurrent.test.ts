// Réception rejouée par deux connexions ; compensation approuvée, aucun DELETE du ledger.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVICE_KEY } from './_helpers/auth';
import { stockDeclarationFixture } from './_helpers/stockDeclarations';

describe.skipIf(!SERVICE_KEY)('stock receipt concurrent replay', () => {
  let fixture: Awaited<ReturnType<typeof stockDeclarationFixture>>;
  beforeAll(async () => {
    fixture = await stockDeclarationFixture('ZZ-TEST-CONCURRENT-RECEIPT');
    await fixture.reset(0);
  });
  afterAll(async () => { await fixture?.cleanup(); });

  it('creates one movement and returns the same durable result', async () => {
    const key = randomUUID();
    const args = {
      p_product_id: fixture.productId, p_quantity: 7,
      p_reason: 'Concurrent receipt test', p_idempotency_key: key,
    };
    const results = await Promise.all([
      fixture.owner.rpc('record_incoming_stock_v3', args),
      fixture.owner.rpc('record_incoming_stock_v3', args),
    ]);
    expect(results.every(result => !result.error)).toBe(true);
    const data = results.map(result => result.data as {
      movement_id: string; idempotent_replay: boolean; new_current_stock: number;
    });
    expect(data[0]!.movement_id).toBeTruthy();
    expect(data[0]!.movement_id).toBe(data[1]!.movement_id);
    expect(data.map(result => result.idempotent_replay).sort()).toEqual([false, true]);
    expect(data.map(result => Number(result.new_current_stock))).toEqual([7, 7]);
    const movements = await fixture.admin.from('stock_movements')
      .select('id', { count: 'exact', head: true }).eq('idempotency_key', key);
    expect(movements.error).toBeNull();
    expect(movements.count).toBe(1);
    expect(await fixture.currentStock()).toBe(7);
  });
});
