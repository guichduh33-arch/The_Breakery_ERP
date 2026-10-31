// Concurrence : déclaration unique, approbation unique et refus des comptes périmés.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SERVICE_KEY } from './_helpers/auth';
import { stockDeclarationFixture, type StockDeclaration } from './_helpers/stockDeclarations';

describe.skipIf(!SERVICE_KEY)('inventory declaration concurrency', () => {
  let fixture: Awaited<ReturnType<typeof stockDeclarationFixture>>;
  beforeAll(async () => { fixture = await stockDeclarationFixture('ZZ-TEST-CONCURRENT-DECLARATION'); });
  beforeEach(async () => { await fixture.reset(); });
  afterAll(async () => { await fixture?.cleanup(); });
  const adjust = (quantity: number) => ({
    p_product_id: fixture.productId, p_new_qty: quantity,
    p_reason: 'Concurrent independent recount', p_idempotency_key: crypto.randomUUID(),
  });

  it('simultaneous retries create one declaration and no stock movement', async () => {
    const request = adjust(150);
    const results = await Promise.all([
      fixture.declarant.rpc('adjust_stock_v4', request),
      fixture.declarant.rpc('adjust_stock_v4', request),
    ]);
    expect(results.every(result => !result.error)).toBe(true);
    const declarations = results.map(result => result.data as StockDeclaration);
    expect(declarations[0]!.declaration_id).toBe(declarations[1]!.declaration_id);
    expect(declarations.map(result => result.idempotent_replay).sort()).toEqual([false, true]);
    expect(await fixture.currentStock()).toBe(100);
    const movements = await fixture.admin.from('stock_movements').select('id', { count: 'exact', head: true })
      .eq('reference_id', declarations[0]!.declaration_id).eq('reference_type', 'stock_declaration');
    expect(movements.error).toBeNull();
    expect(movements.count).toBe(0);
  });

  it('simultaneous approvals emit one movement', async () => {
    const submitted = await fixture.declarant.rpc('adjust_stock_v4', adjust(150));
    expect(submitted.error).toBeNull();
    const id = (submitted.data as StockDeclaration).declaration_id;
    const results = await Promise.all([
      fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id }),
      fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id }),
    ]);
    expect(results.every(result => !result.error)).toBe(true);
    expect(results.map(result => (result.data as StockDeclaration).idempotent_replay).sort()).toEqual([false, true]);
    expect(await fixture.currentStock()).toBe(150);
    const movements = await fixture.admin.from('stock_movements').select('quantity')
      .eq('reference_id', id).eq('reference_type', 'stock_declaration');
    expect(movements.error).toBeNull();
    expect(movements.data).toHaveLength(1);
    expect(Number(movements.data![0]!.quantity)).toBe(50);
  });

  it('a loss approved first makes an older absolute count stale', async () => {
    const [count, waste] = await Promise.all([
      fixture.declarant.rpc('adjust_stock_v4', adjust(130)),
      fixture.declarant.rpc('waste_stock_v4', {
        p_product_id: fixture.productId, p_quantity: 10,
        p_reason: 'Concurrent loss declaration', p_idempotency_key: crypto.randomUUID(),
      }),
    ]);
    expect(count.error).toBeNull();
    expect(waste.error).toBeNull();
    expect((await fixture.owner.rpc('approve_stock_declaration_v3', {
      p_declaration_id: (waste.data as StockDeclaration).declaration_id,
    })).error).toBeNull();
    const stale = await fixture.owner.rpc('approve_stock_declaration_v3', {
      p_declaration_id: (count.data as StockDeclaration).declaration_id,
    });
    expect(stale.error?.message).toMatch(/stale_stock_declaration/);
    expect(await fixture.currentStock()).toBe(90);
  });
});
