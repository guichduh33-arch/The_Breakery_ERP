// supabase/tests/functions/_helpers/fixtures.ts
// S78 (D-6) — produits de test STABLES pour les specs live.
//
// Pourquoi : les specs qui résolvaient un produit seed par sku (BEV-AMER…)
// ou par LIMIT 1 non filtré pourrissent dès que la DB dev vivante bouge
// (soft-delete BO, stock à 0, track_inventory off). Un produit de test dédié,
// upserté par sku fixe `ZZ-TEST-*` et RESTAURÉ à chaque run (deleted_at NULL,
// is_active true), rend la fixture idempotente sans accumuler de lignes.
//
// Convention : sku préfixé ZZ-TEST- (trié en fin de catalogue, identifiable),
// name explicite « [TEST] … » — ces produits sont des artefacts de test admis
// sur la DB dev, ne pas les purger à la main.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface TestProductSpec {
  sku: string;
  name: string;
  retail_price?: number;
  cost_price?: number;
  current_stock?: number;
  min_stock_threshold?: number;
  track_inventory?: boolean;
  unit?: string;
}

/**
 * Upsert-restore d'un produit de test par sku fixe. Retourne son id.
 * - existe → UPDATE (restauration deleted_at/is_active + overrides)
 * - absent → INSERT (catégorie = la première du catalogue)
 */
export async function ensureTestProduct(
  admin: SupabaseClient,
  spec: TestProductSpec,
): Promise<string> {
  const values = {
    name: spec.name,
    retail_price: spec.retail_price ?? 10000,
    cost_price: spec.cost_price ?? 5000,
    current_stock: spec.current_stock ?? 100,
    min_stock_threshold: spec.min_stock_threshold ?? 0,
    track_inventory: spec.track_inventory ?? true,
    unit: spec.unit ?? 'pcs',
    is_active: true,
    is_display_item: false,
    deleted_at: null,
  };

  const { data: existing, error: selErr } = await admin
    .from('products')
    .select('id')
    .eq('sku', spec.sku)
    .maybeSingle();
  if (selErr) throw new Error(`ensureTestProduct select: ${JSON.stringify(selErr)}`);

  if (existing) {
    const { error } = await admin.from('products').update(values).eq('id', existing.id);
    if (error) throw new Error(`ensureTestProduct update: ${JSON.stringify(error)}`);
    return existing.id as string;
  }

  const { data: cat, error: catErr } = await admin
    .from('categories')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  if (catErr || !cat) throw new Error(`ensureTestProduct: no category (${JSON.stringify(catErr)})`);

  const { data: inserted, error: insErr } = await admin
    .from('products')
    .insert({ sku: spec.sku, category_id: cat.id, ...values })
    .select('id')
    .single();
  if (insErr || !inserted) throw new Error(`ensureTestProduct insert: ${JSON.stringify(insErr)}`);
  return inserted.id as string;
}
