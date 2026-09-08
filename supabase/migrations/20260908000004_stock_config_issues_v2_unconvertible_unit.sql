-- 20260908000004_stock_config_issues_v2_unconvertible_unit.sql
--
-- Volet AMONT du finding F1 (docs/audits/2026-08-31-audit-stock-management.md).
--
-- `20260908000003` a fermé la porte : une ligne de recette dont la paire d'unités
-- n'est pas convertible fait désormais ÉCHOUER la vente au lieu de déduire un nombre
-- faux. C'est le bon comportement, mais pris seul il déplace la surprise du ledger
-- vers le comptoir : le caissier découvrirait le problème au moment d'encaisser.
--
-- Ce volet le rend visible AVANT. L'écran « Product config » des alertes reçoit un
-- type d'anomalie `unconvertible_recipe_unit`, en sévérité `critical` — au même rang
-- que `negative_stock`, parce que la conséquence est du même ordre : le produit n'est
-- pas vendable.
--
-- Le prédicat de convertibilité est le MIROIR EXACT du corps live de
-- `convert_quantity` (relevé le 2026-09-08), dans cet ordre :
--   1. unités identiques ;
--   2. sinon, une ligne `unit_conversions` dans le sens (from → to) — la fonction ne
--      lit PAS le sens inverse, le prédicat non plus ;
--   3. sinon, deux `units` de MÊME dimension avec leurs deux facteurs canoniques.
-- Toute divergence entre ce prédicat et `convert_quantity` rendrait l'écran menteur :
-- si la fonction change, ce bloc change avec elle.
--
-- La ligne signalée est le produit PARENT — celui dont la recette est cassée, donc
-- celui qu'on ne peut pas vendre. Les produits inactifs ne sont pas exclus : c'est
-- précisément là que dorment les deux lignes connues (`Almond cream`, inactif), et
-- une anomalie latente doit se voir avant que le produit ne redevienne vendable.
--
-- La forme de retour est inchangée (mêmes colonnes, même ordre) : le hook du
-- back-office et son tableau n'ont à connaître qu'une valeur de plus.
--
-- Versioning monotone : _v2 créée, _v1 droppée dans ce fichier, signature inchangée.
-- PROVENANCE DU CORPS : pg_get_functiondef sur la base live, relevé le 2026-09-08 ;
-- seul le bloc `unconvertible_recipe_unit` est ajouté, le reste est recopié.
-- Grants : miroir des grants live (authenticated + service_role) + REVOKE PUBLIC/anon.
-- Types à régénérer (packages/supabase/src/types.generated.ts).

CREATE OR REPLACE FUNCTION public.get_stock_config_issues_v2()
RETURNS TABLE(
  product_id uuid,
  sku text,
  name text,
  category_name text,
  issue_type text,
  severity text,
  track_inventory boolean,
  deduct_stock boolean,
  recipe_lines integer,
  current_stock numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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
    SELECT b.id, b.sku, b.name, b.category_name,
           'negative_stock'::text AS issue_type, 'critical'::text AS severity,
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.track_inventory = true AND b.current_stock < 0
    UNION ALL
    -- v2 (F1) : paire d'unités inconvertible entre la ligne de recette et le stock de
    -- la matière. Depuis 20260908000003 la vente ÉCHOUE sur cette ligne au lieu de
    -- déduire la quantité brute — l'anomalie doit se voir avant l'encaissement.
    SELECT b.id, b.sku, b.name, b.category_name,
           'unconvertible_recipe_unit', 'critical',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE EXISTS (
       SELECT 1
         FROM recipes r
         JOIN products m ON m.id = r.material_id
        WHERE r.product_id = b.id
          AND r.is_active AND r.deleted_at IS NULL
          AND m.track_inventory = true
          AND r.unit <> m.unit
          AND NOT EXISTS (
                SELECT 1 FROM unit_conversions uc
                 WHERE uc.from_unit = r.unit AND uc.to_unit = m.unit)
          AND NOT EXISTS (
                SELECT 1
                  FROM units uf
                  JOIN units ut ON ut.dimension = uf.dimension
                 WHERE uf.code = r.unit AND ut.code = m.unit
                   AND uf.factor_to_canonical IS NOT NULL
                   AND ut.factor_to_canonical IS NOT NULL)
     )
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'sale_deduct_no_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = false AND b.deduct_stock = true
       AND b.recipe_lines = 0
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'orphan_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.deduct_stock = false AND b.recipe_lines > 0
    UNION ALL
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
END $function$;

REVOKE EXECUTE ON FUNCTION public.get_stock_config_issues_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_stock_config_issues_v2() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stock_config_issues_v2() TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.get_stock_config_issues_v2() IS
  'Anomalies de configuration produit/recette de l''écran Alerts. v2 (F1, 2026-09-08) '
  'ajoute unconvertible_recipe_unit en severity critical : son prédicat est le miroir '
  'du corps de convert_quantity — si cette fonction change, ce prédicat change avec '
  'elle, sinon l''écran ment.';

DROP FUNCTION IF EXISTS public.get_stock_config_issues_v1();
