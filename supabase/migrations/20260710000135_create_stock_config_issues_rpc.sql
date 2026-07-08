-- 20260710000135_create_stock_config_issues_rpc.sql
-- Alerte "produits mal configurés" pour la déduction de stock à la vente.
-- Read-only (SECURITY INVOKER), gate inventory.read (miroir get_low_stock_v1).
--
-- Contexte (audit 2026-07-08) : à la vente, complete_order_with_payment_v17
-- aiguille IF track_inventory (décrémente le fini) ELSIF deduct_stock (déduit la
-- recette) ELSE rien. La production n'étant quasiment jamais enregistrée, un
-- produit track_inventory=true ne voit ses ingrédients déduits nulle part.
-- Ce RPC remonte les combinaisons flags/recette qui ne déduisent pas ce que
-- l'exploitant attend. 4 types (severité : critical > warning > info) :
--   negative_stock            (critical) : produit suivi au stock négatif (jamais reçu/produit).
--   sale_deduct_no_recipe     (warning)  : fait-à-la-commande (track=false, deduct=true) SANS recette -> déduit rien.
--   orphan_recipe             (warning)  : recette définie mais deduct_stock=false -> jamais consommée.
--   tracked_recipe_at_prod    (info)     : track=true + recette + vendu -> la recette ne déduit qu'À LA PRODUCTION
--                                          (à enregistrer via record_production_v1), pas à la vente.

CREATE OR REPLACE FUNCTION public.get_stock_config_issues_v1()
RETURNS TABLE (
  product_id      UUID,
  sku             TEXT,
  name            TEXT,
  category_name   TEXT,
  issue_type      TEXT,
  severity        TEXT,
  track_inventory BOOLEAN,
  deduct_stock    BOOLEAN,
  recipe_lines    INTEGER,
  current_stock   DECIMAL(10,3)
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id, p.sku, p.name, c.name AS category_name,
      p.track_inventory, p.deduct_stock, p.is_display_item,
      p.visible_on_pos, p.is_active, p.product_type, p.current_stock,
      (SELECT count(*)::int FROM recipes r
        WHERE r.product_id = p.id AND r.is_active AND r.deleted_at IS NULL) AS recipe_lines,
      EXISTS (SELECT 1 FROM recipes r2
        WHERE r2.material_id = p.id AND r2.is_active AND r2.deleted_at IS NULL) AS used_as_ingredient
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL
  ),
  issues AS (
    -- critical : produit SUIVI au stock négatif (le fini n'a jamais été reçu/produit)
    SELECT b.id, b.sku, b.name, b.category_name,
           'negative_stock'::text AS issue_type, 'critical'::text AS severity,
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.track_inventory = true AND b.current_stock < 0

    UNION ALL
    -- warning : fait-à-la-commande sans recette -> déduit rien à la vente
    SELECT b.id, b.sku, b.name, b.category_name,
           'sale_deduct_no_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = false AND b.deduct_stock = true
       AND b.recipe_lines = 0

    UNION ALL
    -- warning : recette définie mais deduct_stock=false -> jamais consommée
    SELECT b.id, b.sku, b.name, b.category_name,
           'orphan_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.deduct_stock = false AND b.recipe_lines > 0

    UNION ALL
    -- info : produit suivi + recette + vendu -> la recette ne déduit qu'à la production
    SELECT b.id, b.sku, b.name, b.category_name,
           'tracked_recipe_at_prod', 'info',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = true AND b.deduct_stock = true
       AND b.recipe_lines > 0 AND b.used_as_ingredient = false
  )
  SELECT i.id, i.sku, i.name, i.category_name, i.issue_type, i.severity,
         i.track_inventory, i.deduct_stock, i.recipe_lines, i.current_stock
    FROM issues i
   ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            i.category_name, i.name;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_stock_config_issues_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_config_issues_v1() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stock_config_issues_v1() TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_stock_config_issues_v1() IS
  'Audit 2026-07-08. inventory.read. Produits dont les flags track_inventory/deduct_stock '
  'et la présence de recette ne déduisent pas le stock attendu à la vente. 4 issue_type : '
  'negative_stock (critical), sale_deduct_no_recipe / orphan_recipe (warning), '
  'tracked_recipe_at_prod (info : recette déduite à la production seulement).';
