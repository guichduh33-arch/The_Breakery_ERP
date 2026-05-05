// packages/domain/src/modifiers/validateSelections.ts
//
// Guard: every `group_required` group must have at least one selected option.
// single_select: exactly-1 (ensured by UI radio — validated here as >= 1)
// multi_select:  >= 1 selection required when group_required (no upper bound v1)
// Spec §1 (M2): session 6 activates multi_select branch.

import type { ModifierGroup, SelectedModifiers } from './types.js';

export interface ValidationError {
  group_name: string;
  reason: 'required_missing';
}

/**
 * Returns an array of errors (one per offending group). Empty array means OK.
 * Optional groups are never flagged regardless of group_type.
 * Multi-select required groups need at least 1 selection (no max enforced v1).
 */
export function validateSelections(
  groups: ModifierGroup[],
  selections: SelectedModifiers,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const selectedGroupNames = new Set(selections.map((s) => s.group_name));
  for (const group of groups) {
    if (group.group_required && !selectedGroupNames.has(group.group_name)) {
      errors.push({ group_name: group.group_name, reason: 'required_missing' });
    }
  }
  return errors;
}
