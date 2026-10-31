import { supabase } from '@/lib/supabase.js';
import type { CountImportRow, CountProduct } from './opnameWorkbook.js';

// Pagination explicite : le plafond PostgREST ne doit pas tronquer le modèle.
export async function loadCountProducts(): Promise<CountProduct[]> {
  const products: CountProduct[] = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await supabase.from('products').select('id, sku, name, unit')
      .is('deleted_at', null).eq('track_inventory', true).order('id').range(start, start + 499);
    if (error) throw error;
    products.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) break;
  }
  return products.sort((a, b) => a.name.localeCompare(b.name));
}

export async function importCountRows(countId: string, rows: readonly CountImportRow[], onSaved: () => void): Promise<void> {
  const existing = new Map<string, { id: string; unit: string }>();
  {
    const { data: payload, error } = await supabase.rpc('get_opname_items_v1', { p_count_id: countId });
    const data = (payload ?? []) as unknown as { id: string; product_id: string; unit: string }[];
    if (error) throw error;
    for (const item of data ?? []) existing.set(item.product_id, item);
  }
  const products = new Map((await loadCountProducts()).map((product) => [product.id, product]));
  for (const row of rows) {
    const product = products.get(row.productId);
    if (!product || (product.unit ?? 'pcs') !== row.unit || (existing.has(row.productId) && existing.get(row.productId)?.unit !== row.unit)) {
      throw new Error(`${row.sku}: Inventory item or unit changed. Download a new template.`);
    }
  }
  // Les quantités sont absolues ; un rejeu après perte réseau ne les additionne pas.
  for (const row of rows) {
    let itemId = existing.get(row.productId)?.id;
    if (!itemId) {
      const result = await supabase.rpc('add_opname_item_v3', { p_count_id: countId, p_product_id: row.productId });
      if (result.error) throw new Error(`${row.sku}: ${result.error.message}`);
      const payload = result.data as { item_id?: string } | null;
      if (!payload?.item_id) throw new Error(`${row.sku}: No count item returned.`);
      itemId = payload.item_id;
    }
    const result = await supabase.rpc('set_opname_count_v3', {
      p_count_item_id: itemId, p_counted_qty: row.quantity, p_notes: row.notes,
    });
    if (result.error) throw new Error(`${row.sku}: ${result.error.message}`);
    onSaved();
  }
}
