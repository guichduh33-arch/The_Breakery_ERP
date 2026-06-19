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
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
