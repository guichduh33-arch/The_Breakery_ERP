// packages/domain/src/modifiers/editModel.ts
//
// Pure (IO-free) helpers for the Backoffice modifiers editor:
//   - foldModifierRowsForEdit: flat product_modifiers rows -> editable groups
//   - validateModifierDraft:   client-side validation rules
//   - serializeModifierGroups: editable groups -> upsert_product_modifiers_v1 p_groups JSONB

import type {
  AdminProductModifierRow,
  EditableModifierGroup,
  EditableModifierOption,
} from './types.js';
import { parseModifierIngredientsToDeduct } from './parseIngredients.js';

export interface ModifierDraftError {
  message: string;
}

export function foldModifierRowsForEdit(
  rows: AdminProductModifierRow[],
): EditableModifierGroup[] {
  const byName = new Map<string, EditableModifierGroup>();
  for (const r of rows) {
    let g = byName.get(r.group_name);
    if (!g) {
      g = {
        group_name: r.group_name,
        group_type: r.group_type,
        group_required: r.group_required,
        group_sort_order: r.group_sort_order,
        options: [],
      };
      byName.set(r.group_name, g);
    }
    const option: EditableModifierOption = {
      option_label: r.option_label,
      price_adjustment: Number(r.price_adjustment) || 0,
      is_default: r.is_default,
      option_sort_order: r.option_sort_order,
      ingredients_to_deduct: parseModifierIngredientsToDeduct(r.ingredients_to_deduct),
    };
    g.options.push(option);
  }
  const groups = [...byName.values()];
  groups.sort(
    (a, b) =>
      a.group_sort_order - b.group_sort_order || a.group_name.localeCompare(b.group_name),
  );
  for (const g of groups) {
    g.options.sort(
      (a, b) =>
        a.option_sort_order - b.option_sort_order ||
        a.option_label.localeCompare(b.option_label),
    );
  }
  return groups;
}

export function validateModifierDraft(
  groups: EditableModifierGroup[],
): ModifierDraftError[] {
  const errors: ModifierDraftError[] = [];
  const seenGroup = new Set<string>();

  for (const g of groups) {
    const gname = g.group_name.trim();
    if (gname === '') {
      errors.push({ message: 'A variant type (group) name is required.' });
    } else {
      const key = gname.toLowerCase();
      if (seenGroup.has(key)) {
        errors.push({ message: `Duplicate variant type name: "${gname}".` });
      }
      seenGroup.add(key);
    }

    if (g.options.length === 0) {
      errors.push({ message: `"${gname || 'Unnamed'}" must have at least one option.` });
    }

    const seenOption = new Set<string>();
    let defaultCount = 0;
    for (const o of g.options) {
      const olabel = o.option_label.trim();
      if (olabel === '') {
        errors.push({ message: `An option in "${gname || 'Unnamed'}" needs a label.` });
      } else {
        const okey = olabel.toLowerCase();
        if (seenOption.has(okey)) {
          errors.push({ message: `Duplicate option "${olabel}" in "${gname}".` });
        }
        seenOption.add(okey);
      }
      if (o.is_default) defaultCount += 1;
      for (const ing of o.ingredients_to_deduct) {
        if (!(ing.qty > 0)) {
          errors.push({
            message: `Ingredient qty must be greater than 0 in option "${olabel || 'Unnamed'}".`,
          });
        }
        if (ing.product_id.trim() === '') {
          errors.push({
            message: `Pick a raw material for every ingredient line in "${olabel || 'Unnamed'}".`,
          });
        }
      }
    }

    if (g.group_type === 'single_select' && g.group_required && defaultCount !== 1) {
      errors.push({
        message: `Required single-select "${gname || 'Unnamed'}" must have exactly one default option.`,
      });
    }
    if (g.group_type === 'single_select' && !g.group_required && defaultCount > 1) {
      errors.push({
        message: `Single-select "${gname || 'Unnamed'}" can have at most one default option.`,
      });
    }
  }

  return errors;
}

export function serializeModifierGroups(groups: EditableModifierGroup[]): unknown {
  return groups.map((g, gi) => ({
    group_name: g.group_name.trim(),
    group_type: g.group_type,
    group_required: g.group_required,
    group_sort_order: gi,
    options: g.options.map((o, oi) => ({
      option_label: o.option_label.trim(),
      option_sort_order: oi,
      price_adjustment: o.price_adjustment,
      is_default: o.is_default,
      ingredients_to_deduct: o.ingredients_to_deduct.map((ing) => ({
        product_id: ing.product_id,
        qty: ing.qty,
        unit: ing.unit,
      })),
    })),
  }));
}
