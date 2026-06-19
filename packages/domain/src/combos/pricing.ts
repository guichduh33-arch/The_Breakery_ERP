// packages/domain/src/combos/pricing.ts
//
// Pricing helpers for configurable combos (session 47).
// All money is integer IDR — no decimals.
import type { ComboDefinition, ComboSelection } from './types.js';

/**
 * Compute the total price of a combo given a set of option selections.
 * Price = base_price + sum of surcharges of selected options.
 */
export function configuredPrice(def: ComboDefinition, sel: ComboSelection[]): number {
  let total = def.base_price;
  for (const group of def.groups) {
    const selForGroup = sel.find((s) => s.group_id === group.id);
    if (!selForGroup) continue;
    for (const optionId of selForGroup.option_ids) {
      const option = group.options.find((o) => o.id === optionId);
      if (option) {
        total += option.surcharge;
      }
    }
  }
  return total;
}

/**
 * Compute the minimum and maximum possible price of a combo
 * based on its group definitions (without knowing selections).
 *
 * - min: base + Σ over groups of (required ? cheapest min_select option surcharges : 0)
 * - max: base + Σ over groups of:
 *     single group → max option surcharge
 *     multi group  → sum of top max_select surcharges
 */
export function priceRange(def: ComboDefinition): { min: number; max: number } {
  let min = def.base_price;
  let max = def.base_price;

  for (const group of def.groups) {
    const sortedSurcharges = group.options.map((o) => o.surcharge).sort((a, b) => a - b);

    if (group.is_required) {
      // min: pick the cheapest min_select options
      const cheapestN = sortedSurcharges.slice(0, group.min_select);
      min += cheapestN.reduce((s, v) => s + v, 0);
    }
    // max: pick top max_select options (most expensive)
    const topN = [...sortedSurcharges].sort((a, b) => b - a).slice(0, group.max_select);
    max += topN.reduce((s, v) => s + v, 0);
  }

  return { min, max };
}

/**
 * Compute the "value price" of a combo — the total retail price of its default
 * component products if bought separately.
 *
 * - For single-choice groups: uses the default option's component retail price.
 * - For multi-choice groups: uses the sum of retail prices for all default options.
 *
 * Returns null if:
 * - There are no groups/options to price
 * - Any required component retail price is missing from componentRetail
 */
export function valuePrice(
  def: ComboDefinition,
  componentRetail: Record<string, number>,
): number | null {
  if (def.groups.length === 0) return null;

  let total = 0;
  let hasAny = false;

  for (const group of def.groups) {
    const defaultOptions = group.options.filter((o) => o.is_default);
    const relevant = defaultOptions.length > 0 ? defaultOptions : group.options.slice(0, 1);

    for (const option of relevant) {
      const retail = componentRetail[option.component_product_id];
      if (retail === undefined) return null;
      total += retail;
      hasAny = true;
    }
  }

  return hasAny ? total : null;
}

/**
 * Compute the savings percentage a combo offers versus its value price.
 *
 * savingsPct = round((value - base) / value * 100) when value > base
 * Returns null when value is null or value <= base (no saving).
 */
export function savingsPct(value: number | null, base: number): number | null {
  if (value === null || value <= base) return null;
  return Math.round(((value - base) / value) * 100);
}
