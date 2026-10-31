// La disponibilité se vérifie à l'approbation ; la déclaration ne déduit rien.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SERVICE_KEY } from './_helpers/auth';
import { stockDeclarationFixture, type StockApproval, type StockDeclaration } from './_helpers/stockDeclarations';

describe.skipIf(!SERVICE_KEY)('stock waste declaration', () => {
  let fixture: Awaited<ReturnType<typeof stockDeclarationFixture>>;
  beforeAll(async () => { fixture = await stockDeclarationFixture('ZZ-TEST-WASTE-DECLARATION'); });
  beforeEach(async () => { await fixture.reset(); });
  afterAll(async () => { await fixture?.cleanup(); });
  const args = (quantity: number, reason = 'Damaged inventory') => ({
    p_product_id: fixture.productId, p_quantity: quantity, p_reason: reason,
    p_idempotency_key: crypto.randomUUID(),
  });

  it('records the negative movement only after independent approval', async () => {
    const submitted = await fixture.declarant.rpc('waste_stock_v4', args(8));
    expect(submitted.error).toBeNull();
    expect(await fixture.currentStock()).toBe(100);
    const approved = await fixture.owner.rpc('approve_stock_declaration_v3', {
      p_declaration_id: (submitted.data as StockDeclaration).declaration_id,
    });
    expect(approved.error).toBeNull();
    const result = approved.data as StockApproval;
    expect(Number(result.new_current_stock)).toBe(92);
    const movement = await fixture.admin.from('stock_movements').select('quantity,movement_type')
      .eq('id', result.movement_id).single();
    expect(movement.error).toBeNull();
    expect(Number(movement.data!.quantity)).toBe(-8);
    expect(movement.data!.movement_type).toBe('waste');
  });

  it('accepts a blind declaration and rejects excess stock on approval', async () => {
    const submitted = await fixture.declarant.rpc('waste_stock_v4', args(500));
    expect(submitted.error).toBeNull();
    expect(submitted.data).toMatchObject({ status: 'pending' });
    const approved = await fixture.owner.rpc('approve_stock_declaration_v3', {
      p_declaration_id: (submitted.data as StockDeclaration).declaration_id,
    });
    expect(approved.error?.message).toMatch(/insufficient_stock/);
    expect(await fixture.currentStock()).toBe(100);
  });

  it('replays an approved loss without a second deduction', async () => {
    const request = args(5);
    const submitted = await fixture.declarant.rpc('waste_stock_v4', request);
    expect(submitted.error).toBeNull();
    const id = (submitted.data as StockDeclaration).declaration_id;
    expect((await fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id })).error).toBeNull();
    const replay = await fixture.declarant.rpc('waste_stock_v4', request);
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ declaration_id: id, status: 'approved', idempotent_replay: true });
    const again = await fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id });
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ idempotent_replay: true });
    expect(await fixture.currentStock()).toBe(95);
  });

  it('validates reason and positive quantity', async () => {
    expect((await fixture.declarant.rpc('waste_stock_v4', args(1, 'no'))).error?.message).toMatch(/reason_required/);
    for (const quantity of [0, -3]) {
      expect((await fixture.declarant.rpc('waste_stock_v4', args(quantity))).error?.message).toMatch(/invalid_quantity/);
    }
  });

  it('rejects an unknown product', async () => {
    const rejected = await fixture.declarant.rpc('waste_stock_v4', { ...args(1), p_product_id: crypto.randomUUID() });
    expect(rejected.error?.message).toMatch(/product_not_found/);
  });
});
