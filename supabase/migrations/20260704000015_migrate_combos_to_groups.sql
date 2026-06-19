-- 20260704000015_migrate_combos_to_groups.sql
-- Session 47 / Wave A — migrate legacy fixed combos (combo_items) to the new
-- choice-group model, then drop combo_items.
--
-- Each legacy component becomes one single + required group with a single
-- default option (surcharge 0). Keyed on (parent_product_id, sort_order),
-- verified unique per combo (0 collisions). Per-option quantity is NOT
-- preserved (out of scope §12); combo_base_price seeded from retail_price
-- keeps each combo's price intact.

WITH ins_groups AS (
  INSERT INTO combo_groups (combo_product_id, name, group_type, is_required, min_select, max_select, sort_order)
  SELECT ci.parent_product_id, comp.name, 'single', true, 1, 1, ci.sort_order
  FROM combo_items ci
  JOIN products comp ON comp.id = ci.component_product_id
  RETURNING id, combo_product_id, sort_order
)
INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order)
SELECT ig.id, ci.component_product_id, 0, true, 0
FROM ins_groups ig
JOIN combo_items ci
  ON ci.parent_product_id = ig.combo_product_id
 AND ci.sort_order = ig.sort_order;

UPDATE products
  SET combo_base_price = retail_price
  WHERE product_type = 'combo' AND combo_base_price IS NULL;

-- Drop the legacy fixed-bundle model.
DROP TRIGGER IF EXISTS trg_combo_items_parent_type ON combo_items;
DROP FUNCTION IF EXISTS enforce_combo_parent_type();
DROP TABLE combo_items;
