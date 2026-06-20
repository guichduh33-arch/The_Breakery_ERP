ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS modifier_ingredients_deducted JSONB;

COMMENT ON COLUMN public.order_items.modifier_ingredients_deducted IS
  'Phase 2 snapshot of resolved+converted modifier ingredients deducted for this line: '
  'array of {product_id, qty_base, unit, group_name, option_label}. NULL when no '
  'ingredient-bearing modifiers. Source of truth for void/refund restore.';
