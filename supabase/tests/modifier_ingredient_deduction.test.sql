BEGIN;
SELECT plan(1);

SELECT has_column('public', 'order_items', 'modifier_ingredients_deducted',
  'order_items has modifier_ingredients_deducted snapshot column');

SELECT * FROM finish();
ROLLBACK;
