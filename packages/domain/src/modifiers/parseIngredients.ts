// packages/domain/src/modifiers/parseIngredients.ts
//
// Tolerant parser for the `product_modifiers.ingredients_to_deduct` JSONB
// column. Returns only well-formed rows; never throws (robust at load time).
// Shape per the column comment: { product_id: string, qty: number, unit: string }.

import type { ModifierIngredient } from './types.js';

export function parseModifierIngredientsToDeduct(value: unknown): ModifierIngredient[] {
  if (!Array.isArray(value)) return [];
  const out: ModifierIngredient[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const product_id = typeof r.product_id === 'string' ? r.product_id.trim() : '';
    const unit = typeof r.unit === 'string' ? r.unit.trim() : '';
    const qty = Number(r.qty);
    if (product_id === '' || unit === '') continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ product_id, qty, unit });
  }
  return out;
}
