// packages/domain/src/modifiers/mergeGroups.ts
//
// Merge product-level + category-level modifier rows into a sorted, grouped
// structure ready to feed `<ModifierModal>`.
//
// Spec ref §2.1 (XOR scope) + §4.1: when a `group_name` exists at product-level
// it overrides any category-level group with the same name. Other category
// groups are inherited as fallback.

import type {
  ModifierGroup,
  ModifierGroupOption,
  ProductModifierRow,
} from './types.js';

/**
 * Group flat rows by `group_name`, preserving the row metadata
 * (sort_order, required, type) from the FIRST row encountered for a group.
 *
 * The DB invariant guarantees those metadata are consistent across rows
 * sharing the same (product_id|category_id, group_name) tuple.
 */
function rowsToGroups(rows: ProductModifierRow[]): Map<string, ModifierGroup> {
  const map = new Map<string, ModifierGroup>();
  for (const row of rows) {
    let group = map.get(row.group_name);
    if (!group) {
      group = {
        group_name: row.group_name,
        group_sort_order: row.group_sort_order,
        group_required: row.group_required,
        group_type: row.group_type,
        options: [],
      };
      map.set(row.group_name, group);
    }
    const option: ModifierGroupOption = {
      option_label: row.option_label,
      option_sort_order: row.option_sort_order,
      price_adjustment: row.price_adjustment,
      is_default: row.is_default,
      ...(row.option_icon ? { option_icon: row.option_icon } : {}),
    };
    group.options.push(option);
  }
  return map;
}

/**
 * Merge product-level rows with category-level rows. Product groups always win
 * on naming collision (override). Returns groups sorted by `group_sort_order`,
 * with options sorted by `option_sort_order`.
 *
 * The function is pure and tolerant of:
 * - empty input → returns []
 * - rows with `is_active=false` → callers SHOULD pre-filter, but we don't drop
 *   them here on purpose (keeps the helper purely structural).
 * - missing XOR (both ids null) → row is ignored (defensive).
 */
export function mergeGroups(rows: ProductModifierRow[]): ModifierGroup[] {
  const productRows: ProductModifierRow[] = [];
  const categoryRows: ProductModifierRow[] = [];
  for (const row of rows) {
    if (row.product_id !== null && row.category_id === null) {
      productRows.push(row);
    } else if (row.category_id !== null && row.product_id === null) {
      categoryRows.push(row);
    }
    // else: malformed row (XOR violation) — skip
  }

  const productGroups = rowsToGroups(productRows);
  const categoryGroups = rowsToGroups(categoryRows);

  const merged = new Map<string, ModifierGroup>();
  // Product-level wins
  for (const [name, g] of productGroups) merged.set(name, g);
  // Category fallback only for groups not overridden
  for (const [name, g] of categoryGroups) {
    if (!merged.has(name)) merged.set(name, g);
  }

  const groups = [...merged.values()];
  groups.sort((a, b) => a.group_sort_order - b.group_sort_order);
  for (const group of groups) {
    group.options.sort((a, b) => a.option_sort_order - b.option_sort_order);
  }
  return groups;
}
