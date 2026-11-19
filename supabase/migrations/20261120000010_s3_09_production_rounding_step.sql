-- S3-09 — Arrondir les suggestions de production au pas métier.
--
-- Règle (SPECS §9, arbitrage §2bis lot 9) : la quantité suggérée s'arrondit au
-- pas métier du produit (douzaines, dizaines). La couverture reste à 3 jours.
--
-- 1. Un pas d'arrondi facultatif par produit : products.production_rounding_step.
--    NULL = pas de pas, la suggestion garde l'arrondi entier d'avant.
-- 2. set_production_rounding_step_v1 : pose ou efface ce pas, sous
--    products.update, avec trace dans audit_logs. Fonction dédiée plutôt qu'un
--    bump de update_product_v6 : le réglage vit dans l'onglet des suggestions.
-- 3. get_production_suggestions_v5 : corps live de la v4 (pg_get_functiondef du
--    2026-11-20, mêmes gardes S1-08), plus l'arrondi au pas supérieur et le pas
--    renvoyé à l'écran. La v4 est retirée : son seul appelant est le crochet
--    useProductionSuggestions du back-office, basculé dans le même lot.

ALTER TABLE public.products
  ADD COLUMN production_rounding_step NUMERIC(10,3)
    CONSTRAINT products_production_rounding_step_positive
    CHECK (production_rounding_step IS NULL OR production_rounding_step > 0);

COMMENT ON COLUMN public.products.production_rounding_step IS
  'S3-09 : pas métier de la suggestion de production (12 = douzaine). NULL = arrondi entier.';

CREATE FUNCTION public.set_production_rounding_step_v1(p_product_id uuid, p_step numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor  UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id
  v_before NUMERIC;
  -- La colonne garde 3 décimales : on valide et on trace la valeur STOCKÉE.
  v_step   NUMERIC := round(p_step, 3);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(auth.uid(), 'products.update') OR v_actor IS NULL THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_step IS NOT NULL AND (p_step::text IN ('NaN','Infinity','-Infinity') OR v_step <= 0 OR v_step > 100000) THEN
    RAISE EXCEPTION 'invalid_rounding_step' USING ERRCODE = '22023',
      HINT = 'step must be > 0 and <= 100000, or null to clear';
  END IF;

  SELECT production_rounding_step INTO v_before
    FROM products WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE products
     SET production_rounding_step = v_step,
         updated_at = now()
   WHERE id = p_product_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (v_actor, 'product.production_rounding_step_set', 'products', p_product_id,
          jsonb_build_object('rpc_version', 'v1'),
          jsonb_build_object('before', v_before, 'after', v_step));

  RETURN jsonb_build_object('product_id', p_product_id, 'production_rounding_step', v_step);
END $function$;

CREATE FUNCTION public.get_production_suggestions_v5(p_lookback_days integer DEFAULT 7, p_priority_high integer DEFAULT 3, p_priority_medium integer DEFAULT 7)
 RETURNS TABLE(product_id uuid, product_name text, product_sku text, avg_daily_sales numeric, current_stock numeric, days_of_stock numeric, suggested_quantity numeric, production_rounding_step numeric, priority text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2((now()-p_lookback_days*interval '1 day')::date,current_date);


  IF p_lookback_days IS NULL OR p_lookback_days < 1 THEN
    RAISE EXCEPTION 'lookback_days_must_be_positive' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    WITH sales AS (
      SELECT oi.product_id,
             SUM(oi.quantity)::NUMERIC / p_lookback_days AS avg_daily
      FROM reporting_private.closed_order_items_v1 oi
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = oi.order_id
      WHERE o.created_at >= now() - (p_lookback_days * INTERVAL '1 day')
        AND COALESCE(oi.is_cancelled, false) = false
      GROUP BY oi.product_id
      HAVING SUM(oi.quantity) > 0
    ),
    eligible AS (
      SELECT DISTINCT p.id, p.name, p.sku, p.current_stock, s.avg_daily, p.production_rounding_step AS step
      FROM products p
      JOIN sales s ON s.product_id = p.id
      WHERE p.product_type = 'finished'
        AND p.deleted_at IS NULL
        AND p.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM recipes r
          WHERE r.product_id = p.id
            AND r.is_active = TRUE
            AND r.deleted_at IS NULL
        )
    ),
    needed AS (
      -- Besoin brut, inchangé depuis la v4 : couverture 3 jours, arrondi entier.
      SELECT e.*, GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock)::NUMERIC AS need
      FROM eligible e
    )
    SELECT
      n.id           AS product_id,
      n.name         AS product_name,
      n.sku          AS product_sku,
      n.avg_daily    AS avg_daily_sales,
      n.current_stock,
      CASE WHEN n.avg_daily > 0 THEN n.current_stock / n.avg_daily ELSE NULL END AS days_of_stock,
      -- S3-09 : arrondi au pas supérieur (17 avec un pas de 12 → 24).
      CASE WHEN n.step IS NULL THEN n.need
           ELSE CEIL(n.need / n.step) * n.step END::NUMERIC AS suggested_quantity,
      n.step::NUMERIC AS production_rounding_step,
      CASE
        WHEN n.avg_daily > 0 AND n.current_stock / n.avg_daily < p_priority_high THEN 'high'
        WHEN n.avg_daily > 0 AND n.current_stock / n.avg_daily < p_priority_medium THEN 'medium'
        ELSE 'low'
      END AS priority
    FROM needed n
    WHERE n.need > 0
    ORDER BY
      CASE
        WHEN n.avg_daily > 0 AND n.current_stock / n.avg_daily < p_priority_high THEN 0
        WHEN n.avg_daily > 0 AND n.current_stock / n.avg_daily < p_priority_medium THEN 1
        ELSE 2
      END,
      n.avg_daily DESC;
END $function$;

DROP FUNCTION public.get_production_suggestions_v4(integer, integer, integer);

REVOKE ALL ON FUNCTION public.set_production_rounding_step_v1(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_production_rounding_step_v1(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_production_rounding_step_v1(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_production_rounding_step_v1(uuid, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.get_production_suggestions_v5(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_production_suggestions_v5(integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_production_suggestions_v5(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_suggestions_v5(integer, integer, integer) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
