// packages/domain/src/modifiers/validateSelections.ts
//
// Guard: every `group_required` group must contain at least one selected option
// before the user can confirm in the ModifierModal.
// Spec §1 (M3): v1 = at most 1 selection per group, required boolean toggle.

import type { ModifierGroup, SelectedModifiers } from './types.js';

export interface ValidationError {
  group_name: string;
  reason: 'required_missing';
}

/**
 * Returns an array of errors (one per offending group). Empty array means OK.
 * Optional groups are never flagged.
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
