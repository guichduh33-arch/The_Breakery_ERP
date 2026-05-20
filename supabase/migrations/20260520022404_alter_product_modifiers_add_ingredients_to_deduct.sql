-- Session 27 / Wave 1.A.2 — product_modifiers.ingredients_to_deduct JSONB.
ALTER TABLE product_modifiers
  ADD COLUMN ingredients_to_deduct JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE product_modifiers
  ADD CONSTRAINT product_modifiers_ingredients_array
    CHECK (jsonb_typeof(ingredients_to_deduct) = 'array');

CREATE INDEX idx_pmod_ingredients_to_deduct
  ON product_modifiers USING GIN (ingredients_to_deduct)
  WHERE deleted_at IS NULL AND is_active;

COMMENT ON COLUMN product_modifiers.ingredients_to_deduct IS
  'Array of {product_id UUID, qty NUMERIC, unit TEXT}. When this modifier option is '
  'selected on an order_item, these ingredients are deducted from stock in addition to '
  'the parent product''s recipe. Validated by domain helper parseModifierIngredientsToDeduct.';
