export interface ProductReference { sku: string; name: string; category_id: string; unit: 'pcs'; product_type: 'finished' | 'combo' }
export interface SupplierReference { code: string; name: string }
export interface ReferencePackage {
  format: 'breakery-historical-references/1'; target_project_ref: string;
  products: ProductReference[]; suppliers: SupplierReference[];
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value;
export function parseReferencePackage(raw: string, project: string): ReferencePackage {
  const p: unknown = JSON.parse(raw);
  if (!object(p) || p.format !== 'breakery-historical-references/1' || p.target_project_ref !== project
    || !Array.isArray(p.products) || !Array.isArray(p.suppliers) || p.products.length + p.suppliers.length < 1
    || p.products.length + p.suppliers.length > 100) throw new Error('Invalid reference package or connected database.');
  const identities = new Set<string>();
  for (const r of p.products) {
    if (!object(r) || !text(r.sku, 64) || !/^[A-Z0-9-]+$/.test(r.sku) || !text(r.name, 120) || typeof r.category_id !== 'string' || !uuid.test(r.category_id)
      || r.unit !== 'pcs' || !['finished', 'combo'].includes(String(r.product_type)) || identities.has(`product:${r.sku}`)) throw new Error('Invalid or duplicate product reference.');
    identities.add(`product:${r.sku}`);
  }
  for (const r of p.suppliers) {
    if (!object(r) || !text(r.code, 32) || !/^[A-Za-z0-9-]+$/.test(r.code) || !text(r.name, 120) || /[%_,()]/.test(r.name) || identities.has(`supplier:${r.code}`)) throw new Error('Invalid or duplicate supplier reference.');
    identities.add(`supplier:${r.code}`);
  }
  return p as unknown as ReferencePackage;
}
export function historicalProductPayload(ref: ProductReference) {
  return { sku: ref.sku, name: ref.name, category_id: ref.category_id, unit: ref.unit, product_type: ref.product_type,
    description: 'Historical import reference. Stock and production configuration deferred until the opening stock count.',
    retail_price: 0, cost_price: 0, is_active: false, visible_on_pos: false, available_for_sale: false,
    track_inventory: false, deduct_stock: false, is_display_item: false, is_favorite: false, is_semi_finished: false };
}
