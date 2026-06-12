// apps/backoffice/src/features/catalog-import/templateDefinition.ts
// S41 — single source of truth for the 6-sheet Excel template.
// Consumed by the parser, the empty-template generator AND the export generator.
// Column keys are the exact Excel headers and the exact JSONB payload keys.

export type SheetColumnType = 'text' | 'number' | 'boolean' | 'tags';

export interface SheetColumnDef {
  key: string;
  required: boolean;
  type: SheetColumnType;
}

export type PayloadKey =
  | 'categories' | 'ingredients' | 'products' | 'units' | 'variants' | 'recipes';

export interface SheetDef {
  name: string;          // exact Excel tab name
  payloadKey: PayloadKey;
  columns: readonly SheetColumnDef[];
  example: Record<string, string | number | boolean>;
}

const CONTEXT_COLS: readonly SheetColumnDef[] = [
  { key: 'purchase_unit', required: false, type: 'text' },
  { key: 'recipe_unit',   required: false, type: 'text' },
  { key: 'opname_unit',   required: false, type: 'text' },
  { key: 'sales_unit',    required: false, type: 'text' },
];

export const CATALOG_SHEETS: readonly SheetDef[] = [
  {
    name: 'Categories',
    payloadKey: 'categories',
    columns: [
      { key: 'name',             required: true,  type: 'text' },
      { key: 'dispatch_station', required: false, type: 'text' },
      { key: 'sort_order',       required: false, type: 'number' },
    ],
    example: { name: 'Viennoiserie', dispatch_station: 'bakery', sort_order: 10 },
  },
  {
    name: 'Ingredients',
    payloadKey: 'ingredients',
    columns: [
      { key: 'sku',                 required: true,  type: 'text' },
      { key: 'name',                required: true,  type: 'text' },
      { key: 'unit',                required: true,  type: 'text' },
      { key: 'cost_price',          required: true,  type: 'number' },
      { key: 'category',            required: false, type: 'text' },
      { key: 'min_stock_threshold', required: false, type: 'number' },
      { key: 'shelf_life_hours',    required: false, type: 'number' },
      ...CONTEXT_COLS,
    ],
    example: {
      sku: 'ING-FARINE-T55', name: 'Farine T55', unit: 'kg', cost_price: 12000,
      category: 'Ingredients', purchase_unit: 'kg', recipe_unit: 'g',
    },
  },
  {
    name: 'Products',
    payloadKey: 'products',
    columns: [
      { key: 'sku',              required: true,  type: 'text' },
      { key: 'name',             required: true,  type: 'text' },
      { key: 'category',         required: true,  type: 'text' },
      { key: 'unit',             required: false, type: 'text' },
      { key: 'retail_price',     required: true,  type: 'number' },
      { key: 'wholesale_price',  required: false, type: 'number' },
      { key: 'description',      required: false, type: 'text' },
      { key: 'image_url',        required: false, type: 'text' },
      { key: 'visible_on_pos',   required: false, type: 'boolean' },
      { key: 'is_favorite',      required: false, type: 'boolean' },
      { key: 'shelf_life_hours', required: false, type: 'number' },
      ...CONTEXT_COLS,
    ],
    example: {
      sku: 'PRD-CROISSANT', name: 'Croissant', category: 'Viennoiserie',
      unit: 'pcs', retail_price: 25000, visible_on_pos: true,
    },
  },
  {
    name: 'Units',
    payloadKey: 'units',
    columns: [
      { key: 'product_sku',    required: true,  type: 'text' },
      { key: 'code',           required: true,  type: 'text' },
      { key: 'factor_to_base', required: true,  type: 'number' },
      { key: 'tags',           required: false, type: 'tags' },
    ],
    example: { product_sku: 'ING-FARINE-T55', code: 'g', factor_to_base: 0.001, tags: 'recipe' },
  },
  {
    name: 'Variants',
    payloadKey: 'variants',
    columns: [
      { key: 'parent_sku',    required: true,  type: 'text' },
      { key: 'variant_axis',  required: true,  type: 'text' },
      { key: 'variant_label', required: true,  type: 'text' },
      { key: 'sku',           required: true,  type: 'text' },
      { key: 'retail_price',  required: false, type: 'number' },
      { key: 'image_url',     required: false, type: 'text' },
    ],
    example: {
      parent_sku: 'PRD-CROISSANT', variant_axis: 'flavor',
      variant_label: 'Amande', sku: 'PRD-CROISSANT-AMD', retail_price: 28000,
    },
  },
  {
    name: 'Recipes',
    payloadKey: 'recipes',
    columns: [
      { key: 'product_sku',  required: true,  type: 'text' },
      { key: 'material_sku', required: true,  type: 'text' },
      { key: 'quantity',     required: true,  type: 'number' },
      { key: 'unit',         required: false, type: 'text' },
      { key: 'notes',        required: false, type: 'text' },
    ],
    example: { product_sku: 'PRD-CROISSANT', material_sku: 'ING-FARINE-T55', quantity: 80, unit: 'g' },
  },
];
