// packages/domain/src/combos/types.ts
//
// Combo domain types — session 47 configurable combos (choice-group model).
// Replaces the V1 fixed combo_items shape with configurable groups + options.

/** One selectable option inside a combo group. */
export interface ComboOption {
  id: string;
  component_product_id: string;
  label: string;
  surcharge: number;
  is_default: boolean;
  sort_order: number;
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
}
