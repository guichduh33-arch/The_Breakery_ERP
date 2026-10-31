// Déclaration aveugle, approbation indépendante et rejeu sans seconde écriture.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SERVICE_KEY } from './_helpers/auth';
import { stockDeclarationFixture, type StockApproval, type StockDeclaration } from './_helpers/stockDeclarations';

describe.skipIf(!SERVICE_KEY)('stock adjustment declaration', () => {
  let fixture: Awaited<ReturnType<typeof stockDeclarationFixture>>;
  beforeAll(async () => { fixture = await stockDeclarationFixture('ZZ-TEST-ADJUST-DECLARATION'); });
  beforeEach(async () => { await fixture.reset(50); });
  afterAll(async () => { await fixture?.cleanup(); });
  const args = (quantity: number, reason = 'Independent recount') => ({
    p_product_id: fixture.productId, p_new_qty: quantity, p_reason: reason,
    p_idempotency_key: crypto.randomUUID(),
  });

  it('changes stock and audits the Owner only after approval', async () => {
    const submitted = await fixture.declarant.rpc('adjust_stock_v4', args(75));
    expect(submitted.error).toBeNull();
    const declaration = submitted.data as StockDeclaration;
    expect(declaration.status).toBe('pending');
    expect(submitted.data).not.toHaveProperty('new_current_stock');
    expect(await fixture.currentStock()).toBe(50);
    const approved = await fixture.owner.rpc('approve_stock_declaration_v3', {
      p_declaration_id: declaration.declaration_id,
    });
    expect(approved.error).toBeNull();
    const result = approved.data as StockApproval;
    expect(Number(result.new_current_stock)).toBe(75);
    const movement = await fixture.admin.from('stock_movements').select('quantity,movement_type,created_by')
      .eq('id', result.movement_id).single();
    expect(movement.error).toBeNull();
    expect(Number(movement.data!.quantity)).toBe(25);
    expect(movement.data!.movement_type).toBe('adjustment');
    const audit = await fixture.admin.from('audit_logs').select('actor_id')
      .eq('entity_id', declaration.declaration_id).eq('action', 'stock.declaration_approved').single();
    expect(audit.error).toBeNull();
    expect(audit.data!.actor_id).toBe(movement.data!.created_by);
  });

  it('replays declarations and approvals without emitting another movement', async () => {
    const request = args(80);
    const first = await fixture.declarant.rpc('adjust_stock_v4', request);
    const replay = await fixture.declarant.rpc('adjust_stock_v4', request);
    expect(first.error).toBeNull();
    expect(replay.error).toBeNull();
    const id = (first.data as StockDeclaration).declaration_id;
    expect(replay.data).toMatchObject({ declaration_id: id, idempotent_replay: true });
    const approved = await fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id });
    const again = await fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id });
    expect(approved.error).toBeNull();
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ idempotent_replay: true });
    const count = await fixture.admin.from('stock_movements').select('id', { count: 'exact', head: true })
      .eq('reference_type', 'stock_declaration').eq('reference_id', id);
    expect(count.error).toBeNull();
    expect(count.count).toBe(1);
  });

  it('does not let the declarant approve', async () => {
    const submitted = await fixture.declarant.rpc('adjust_stock_v4', args(60));
    expect(submitted.error).toBeNull();
    const denied = await fixture.declarant.rpc('approve_stock_declaration_v3', {
      p_declaration_id: (submitted.data as StockDeclaration).declaration_id,
    });
    expect(denied.error?.message).toMatch(/owner_required/);
    expect(await fixture.currentStock()).toBe(50);
  });

  it('rejects a stale absolute count after intervening stock activity', async () => {
    const submitted = await fixture.declarant.rpc('adjust_stock_v4', args(60));
    expect(submitted.error).toBeNull();
    const incoming = await fixture.owner.rpc('record_incoming_stock_v4', {
      p_product_id: fixture.productId, p_quantity: 2, p_reason: 'Intervening receipt',
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(incoming.error).toBeNull();
    const approved = await fixture.owner.rpc('approve_stock_declaration_v3', {
      p_declaration_id: (submitted.data as StockDeclaration).declaration_id,
    });
    expect(approved.error?.message).toMatch(/stale_stock_declaration/);
    expect(await fixture.currentStock()).toBe(52);
  });

  it('retains a no-op approval without a ledger movement', async () => {
    const submitted = await fixture.declarant.rpc('adjust_stock_v4', args(50));
    expect(submitted.error).toBeNull();
    const id = (submitted.data as StockDeclaration).declaration_id;
    const approved = await fixture.owner.rpc('approve_stock_declaration_v3', { p_declaration_id: id });
    expect(approved.error).toBeNull();
    expect(Number((approved.data as StockApproval).new_current_stock)).toBe(50);
    const count = await fixture.admin.from('stock_movements').select('id', { count: 'exact', head: true })
      .eq('reference_id', id).eq('reference_type', 'stock_declaration');
    expect(count.error).toBeNull();
    expect(count.count).toBe(0);
  });

  it('validates quantity, reason and the required idempotency key', async () => {
    expect((await fixture.declarant.rpc('adjust_stock_v4', args(-5))).error?.message).toMatch(/invalid_quantity/);
    expect((await fixture.declarant.rpc('adjust_stock_v4', args(70, 'hi'))).error?.message).toMatch(/reason_required/);
    const request = { ...args(70), p_idempotency_key: undefined };
    expect((await fixture.declarant.rpc('adjust_stock_v4', request)).error?.message).toMatch(/idempotency_key_required/);
  });
});
