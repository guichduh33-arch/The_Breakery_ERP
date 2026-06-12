-- 20260626000015_production_in_actual_cost_valuation.sql
-- Audit 2026-06-12 M5 : le produit fini était valorisé à products.cost_price
-- (stale) au lieu du coût réellement consommé → écart muet en 5110
-- (constat : production 5 pcs valorisée 35 000 vs 72 300 consommés).
-- 3 changements, signatures inchangées (DO-block replace, pattern S38) :
--   1. record_production_v1 accumule le coût consommé (_leaf_consumption est
--      peuplée AVANT l'émission du production_in).
--   2. production_in valorisé au coût unitaire réel (total consommé / yield réel).
--      record_batch_production_v1 délègue à record_production_v1 (vérifié) →
--      un seul site à changer.
--   3. Le trigger WAC tr_update_product_cost_on_purchase couvre production_in :
--      le cost_price du produit fini suit la production (la fonction du trigger
--      est générique — quantity>0 + unit_cost>0 + lecture du stock pré-mouvement).

-- 1+2. record_production_v1
DO $do$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.record_production_v1'::regproc) INTO v_def;
  IF position('v_total_consumed' in v_def) > 0 THEN
    RETURN;  -- déjà appliqué (idempotent)
  END IF;
  -- déclaration
  v_def := replace(v_def,
$anchor$  v_existing_row      production_records%ROWTYPE;$anchor$,
$new$  v_existing_row      production_records%ROWTYPE;
  v_total_consumed    DECIMAL(14,2) := 0;$new$);
  -- accumulation + valorisation du production_in au coût réel
  v_def := replace(v_def,
$anchor$  v_in_result := record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'production_in',
    p_quantity        := v_actual_yield,
    p_reason          := 'Production batch ' || v_production_number,
    p_unit_cost       := v_product_cost,$anchor$,
$new$  SELECT COALESCE(SUM(total_consumed * material_cost), 0)::DECIMAL(14,2)
    INTO v_total_consumed FROM _leaf_consumption;

  v_in_result := record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'production_in',
    p_quantity        := v_actual_yield,
    p_reason          := 'Production batch ' || v_production_number,
    p_unit_cost       := CASE WHEN v_actual_yield > 0
                              THEN round(v_total_consumed / v_actual_yield, 2)
                              ELSE NULL END,$new$);
  EXECUTE v_def;
END $do$;

-- 3. Le WAC du produit fini suit la production.
DROP TRIGGER IF EXISTS tr_update_product_cost_on_purchase ON public.stock_movements;
CREATE TRIGGER tr_update_product_cost_on_purchase
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW
  WHEN (NEW.movement_type IN ('purchase', 'production_in'))
  EXECUTE FUNCTION public.tr_update_product_cost_on_purchase();
