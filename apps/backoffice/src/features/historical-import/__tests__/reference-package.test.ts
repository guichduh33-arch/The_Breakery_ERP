import { describe, expect, it } from 'vitest';
import { historicalProductPayload, parseReferencePackage } from '../referencePackage.js';
const project = 'yjhhhmjgsmyzyymvixot';
function input() { return { format: 'breakery-historical-references/1', target_project_ref: project,
  products: [{ sku: 'SAV-006', name: 'Beef Puff', category_id: '10000000-0000-0000-0000-000000000001', unit: 'pcs', product_type: 'finished' }],
  suppliers: [{ code: 'HIST-HASIL-BOEMI', name: 'Hasil boemi' }] }; }
describe('historical reference boundary', () => {
  it('rejects a package for another project', () => {
    expect(() => parseReferencePackage(JSON.stringify(input()), 'other')).toThrow(/database/);
  });
  it('does not trust stock or activation settings in the source file', () => {
    const p = input(); Object.assign(p.products[0]!, { is_active: true, current_stock: 999, visible_on_pos: true });
    const parsed = parseReferencePackage(JSON.stringify(p), project);
    const payload = historicalProductPayload(parsed.products[0]!);
    expect(payload).toMatchObject({ is_active: false, visible_on_pos: false, available_for_sale: false,
      track_inventory: false, deduct_stock: false, is_display_item: false, retail_price: 0, cost_price: 0 });
    expect(payload).not.toHaveProperty('current_stock');
  });
  it('rejects duplicate identities before any creation', () => {
    const p = input(); p.products.push(p.products[0]!);
    expect(() => parseReferencePackage(JSON.stringify(p), project)).toThrow(/duplicate/);
  });
  it('rejects filter syntax in supplier identity fields', () => {
    const p = input(); p.suppliers[0]!.code = 'x,name.ilike.*';
    expect(() => parseReferencePackage(JSON.stringify(p), project)).toThrow(/supplier/);
    const p2 = input(); p2.suppliers[0]!.name = 'a,b';
    expect(() => parseReferencePackage(JSON.stringify(p2), project)).toThrow(/supplier/);
  });
  it('preserves combo identity for later configuration without making it available', () => {
    const p = input(); p.products[0]!.product_type = 'combo';
    const parsed = parseReferencePackage(JSON.stringify(p), project);
    expect(historicalProductPayload(parsed.products[0]!)).toMatchObject({ product_type: 'combo', is_active: false });
  });
});
