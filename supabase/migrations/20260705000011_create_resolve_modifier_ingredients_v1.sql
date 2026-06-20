CREATE OR REPLACE FUNCTION public._resolve_modifier_ingredients_v1(
  p_product_id UUID,
  p_modifiers  JSONB,
  p_line_qty   NUMERIC
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH chosen AS (
    SELECT m->>'group_name'   AS group_name,
           m->>'option_label' AS option_label
    FROM jsonb_array_elements(COALESCE(p_modifiers, '[]'::jsonb)) m
  ),
  opt AS (
    SELECT c.group_name, c.option_label, pm.ingredients_to_deduct
    FROM chosen c
    JOIN product_modifiers pm
      ON pm.product_id  = p_product_id
     AND pm.group_name  = c.group_name
     AND pm.option_label = c.option_label
     AND pm.is_active    = true
     AND pm.deleted_at IS NULL
    WHERE pm.ingredients_to_deduct IS NOT NULL
      AND jsonb_typeof(pm.ingredients_to_deduct) = 'array'
  ),
  line AS (
    SELECT o.group_name,
           o.option_label,
           (i->>'product_id')::uuid AS product_id,
           (i->>'qty')::numeric     AS qty,
           i->>'unit'               AS unit
    FROM opt o,
         jsonb_array_elements(o.ingredients_to_deduct) i
    WHERE (i->>'product_id') IS NOT NULL
      AND (i->>'qty')::numeric > 0
  ),
  conv AS (
    SELECT l.product_id,
           pr.unit AS base_unit,
           l.group_name,
           l.option_label,
           l.qty
             * CASE
                 WHEN l.unit = pr.unit THEN 1
                 ELSE COALESCE(
                   (SELECT pua.factor_to_base
                      FROM product_unit_alternatives pua
                     WHERE pua.product_id = l.product_id
                       AND pua.code = l.unit
                     LIMIT 1), 1)
               END
             * p_line_qty AS qty_base
    FROM line l
    JOIN products pr ON pr.id = l.product_id
  )
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'product_id',   product_id,
      'qty_base',     qty_base,
      'unit',         base_unit,
      'group_name',   group_name,
      'option_label', option_label
    )),
    '[]'::jsonb)
  FROM conv;
$$;

REVOKE EXECUTE ON FUNCTION public._resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC) FROM anon;
REVOKE EXECUTE ON FUNCTION public._resolve_modifier_ingredients_v1(UUID, JSONB, NUMERIC) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
