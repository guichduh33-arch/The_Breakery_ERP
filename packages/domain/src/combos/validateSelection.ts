// packages/domain/src/combos/validateSelection.ts
//
// Validates a customer's combo selections against a ComboDefinition (session 47).
import type { ComboDefinition, ComboSelection } from './types.js';

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validate that a set of selections satisfies the rules of a combo definition.
 *
 * Rules checked per group:
 * 1. Required group must have at least min_select valid picks.
 * 2. No group may have more than max_select picks.
 * 3. All option_ids in a selection must exist in the group's options list.
 *
 * Returns `{ ok: true }` if all checks pass, otherwise `{ ok: false, errors: string[] }`
 * where each error message mentions the offending group name.
 */
export function validateSelection(
  def: ComboDefinition,
  sel: ComboSelection[],
): ValidationResult {
  const errors: string[] = [];

  for (const group of def.groups) {
    const selForGroup = sel.find((s) => s.group_id === group.id);
    const chosen = selForGroup?.option_ids ?? [];

    // Validate that all chosen option ids actually exist in the group
    const validOptionIds = new Set(group.options.map((o) => o.id));
    const invalidIds = chosen.filter((id) => !validOptionIds.has(id));
    if (invalidIds.length > 0) {
      errors.push(
        `"${group.name}": unknown option id(s): ${invalidIds.join(', ')}`,
      );
      // Don't count invalid picks toward min/max checks to avoid confusing errors
      continue;
    }

    const count = chosen.length;

    // Check under min_select (applies when group is required or min_select > 0)
    if (count < group.min_select) {
      errors.push(
        `"${group.name}": select at least ${group.min_select} option(s) (got ${count})`,
      );
    }

    // Check over max_select
    if (count > group.max_select) {
      errors.push(
        `"${group.name}": select at most ${group.max_select} option(s) (got ${count})`,
      );
    }

    // ADR-017 D2 — a component retained here is configured as if sold alone:
    // every REQUIRED modifier group it carries must have an answer. Only
    // retained options are examined; a component that is not in the basket asks
    // nothing (the group's own min_select already speaks for that case).
    for (const optionId of chosen) {
      const option = group.options.find((o) => o.id === optionId);
      const modGroups = option?.component_modifier_groups ?? [];
      if (modGroups.length === 0) continue;

      const answered = selForGroup?.option_modifiers?.[optionId] ?? [];

      for (const modGroup of modGroups) {
        const picks = answered.filter((m) => m.group_name === modGroup.group_name);

        const validLabels = new Set(modGroup.options.map((o) => o.option_label));
        const unknown = picks.filter((p) => !validLabels.has(p.option_label));
        if (unknown.length > 0) {
          errors.push(
            `"${option?.label ?? optionId} / ${modGroup.group_name}": unknown option(s): ${unknown
              .map((u) => u.option_label)
              .join(', ')}`,
          );
          continue;
        }

        if (modGroup.group_required && picks.length === 0) {
          errors.push(
            `"${option?.label ?? optionId} / ${modGroup.group_name}": answer required`,
          );
        }
        if (modGroup.group_type === 'single_select' && picks.length > 1) {
          errors.push(
            `"${option?.label ?? optionId} / ${modGroup.group_name}": select at most 1 option (got ${picks.length})`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
