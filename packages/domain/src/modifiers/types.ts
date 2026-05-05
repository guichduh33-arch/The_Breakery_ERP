// packages/domain/src/modifiers/types.ts
//
// Modifier domain types — session 2.
// A modifier is a customisation choice attached to a product (e.g. Hot/Ice,
// type of milk, sugar level…). Modifiers may add a price adjustment that is
// stacked on top of the unit price.
//
// Spec ref: docs/superpowers/specs/2026-05-05-session-2-modifiers-kds-spec.md
// §3.1, §3.3, §4.1, §4.7
//
// v1 supports only `single_select` groups. `multi_select` is reserved for
// session 5 (combos) but the type is exposed here so the schema stays stable.

export type ModifierGroupType = 'single_select' | 'multi_select';

/**
 * Snapshot of a single chosen option, persisted into `order_items.modifiers`
 * (JSONB column).
 *
 * The shape MUST match the JSONB schema in spec §3.3:
 * `{ group_name, option_label, price_adjustment }`.
 */
export interface ModifierOption {
  group_name: string;
  option_label: string;
  /** Additive on `unit_price`. May be 0. */
  price_adjustment: number;
}

/**
 * Single available option within a group, as exposed to the UI.
 */
export interface ModifierGroupOption {
  option_label: string;
  /** Optional emoji or icon name (Lucide). */
  option_icon?: string;
  option_sort_order: number;
  price_adjustment: number;
  /** When true, pre-selected at modal open. */
  is_default: boolean;
}

/**
 * Group of options (e.g. "Temperature") shown as a Card in the modal.
 */
export interface ModifierGroup {
  group_name: string;
  group_sort_order: number;
  group_required: boolean;
  group_type: ModifierGroupType;
  options: ModifierGroupOption[];
}

/**
 * Selections made by the cashier — array of chosen options across groups.
 */
export type SelectedModifiers = ModifierOption[];

/**
 * Raw row shape from the `product_modifiers` table — one row per option.
 * The `mergeGroups()` helper folds these flat rows into `ModifierGroup[]`.
 *
 * Note: `product_id` and `category_id` are XOR-constrained at the DB level
 * (spec §3.1).
 */
export interface ProductModifierRow {
  id: string;
  product_id: string | null;
  category_id: string | null;
  group_name: string;
  group_sort_order: number;
  group_required: boolean;
  group_type: ModifierGroupType;
  option_label: string;
  option_icon: string | null;
  option_sort_order: number;
  price_adjustment: number;
  is_default: boolean;
  is_active: boolean;
}
