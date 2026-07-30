// packages/domain/src/combos/types.ts
//
// Combo domain types — session 47 configurable combos (choice-group model).
// Replaces the V1 fixed combo_items shape with configurable groups + options.
//
// ADR-017 — a component retained in a combo is configured as if it were sold on
// its own: its own modifier groups are answered, billed and deducted. They hang
// off the option (the component), never off the combo product, which does not
// carry them.

import type { ModifierGroup, SelectedModifiers } from '../modifiers/types.js';

/** One selectable option inside a combo group. */
export interface ComboOption {
  id: string;
  component_product_id: string;
  label: string;
  surcharge: number;
  is_default: boolean;
  sort_order: number;
  /**
   * ADR-017 — modifier groups carried by the COMPONENT behind this option
   * (product scope, then category scope), resolved when the definition loads.
   * Absent or empty for a component without modifiers.
   */
  component_modifier_groups?: ModifierGroup[];
}

/** A group of options within a combo (e.g. "Choose a drink"). */
export interface ComboGroup {
  id: string;
  name: string;
  group_type: 'single' | 'multi';
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: ComboOption[];
}

/** Full definition of a configurable combo product. */
export interface ComboDefinition {
  combo_product_id: string;
  name: string;
  base_price: number;
  groups: ComboGroup[];
}

/** Customer's selection for one combo group. */
export interface ComboSelection {
  group_id: string;
  option_ids: string[];
  /**
   * ADR-017 — modifiers answered for each retained option, keyed by option id.
   * A required group of a component MUST NOT be pre-filled: an answer posted by
   * default is never missing, and the block that ADR-017 decision 2 asks for
   * would never fire. Absence of a key means "not answered yet".
   */
  option_modifiers?: Record<string, SelectedModifiers>;
}
