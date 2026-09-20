-- Coûts et marges actualisés dans la transaction métier, plus par balayage quotidien.
-- Corps des deux déclencheurs repris de pg_get_functiondef sur V3 le 2026-09-19.
-- Aucun changement des RPC publiques ni des formules de coût existantes.
-- Recalcul ciblé des alertes : mêmes seuils que le traitement planifié.
CREATE OR REPLACE FUNCTION public._refresh_recipe_margin(p_product_id uuid, p_cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_margin numeric;
  v_alert uuid;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT id INTO v_alert FROM public.margin_alerts
    WHERE product_id = p_product_id AND acknowledged_at IS NULL LIMIT 1;
  IF v_product.target_gross_margin_pct IS NULL OR v_product.retail_price <= 0 OR
     NOT EXISTS (SELECT 1 FROM public.recipes WHERE product_id = p_product_id AND is_active AND deleted_at IS NULL) THEN
    IF v_alert IS NOT NULL THEN
      UPDATE public.margin_alerts SET acknowledged_at = now(), computed_at = now(),
        notes = concat_ws(E'\n', nullif(notes, ''), 'auto-recovered: no active margin target or recipe')
        WHERE id = v_alert;
    END IF;
    RETURN;
  END IF;
  v_margin := round((v_product.retail_price - p_cost) / v_product.retail_price * 100, 2);
  IF v_margin < v_product.target_gross_margin_pct THEN
    IF v_alert IS NULL THEN
      INSERT INTO public.margin_alerts
        (product_id, expected_margin_pct, target_margin_pct, delta_pct, cost_per_unit, selling_price, computed_at)
      VALUES (p_product_id, v_margin, v_product.target_gross_margin_pct,
        v_margin - v_product.target_gross_margin_pct, p_cost, v_product.retail_price, now());
    ELSE
      UPDATE public.margin_alerts SET expected_margin_pct = v_margin,
        target_margin_pct = v_product.target_gross_margin_pct,
        delta_pct = v_margin - v_product.target_gross_margin_pct,
        cost_per_unit = p_cost, selling_price = v_product.retail_price, computed_at = now()
        WHERE id = v_alert;
    END IF;
  ELSIF v_alert IS NOT NULL THEN
    UPDATE public.margin_alerts SET acknowledged_at = now(), computed_at = now(),
      notes = concat_ws(E'\n', nullif(notes, ''), 'auto-recovered') WHERE id = v_alert;
  END IF;
END $function$;

-- Le snapshot calcule déjà le coût récursif : réutiliser sa valeur, sans second parcours.
CREATE OR REPLACE FUNCTION public._snapshot_recipe_and_refresh_cost(
  p_product_id uuid, p_change_note text, p_profile uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_version uuid;
  v_cost numeric;
  v_old numeric;
  v_previous text := current_setting('breakery.recipe_cost_refresh', true);
BEGIN
  SELECT cost_price INTO v_old FROM public.products
    WHERE id = p_product_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_version := public._snapshot_recipe_version(p_product_id, p_change_note, p_profile);
  SELECT (snapshot->>'product_cost_at_version')::numeric INTO v_cost
    FROM public.recipe_versions WHERE id = v_version;
  -- Sans recette, conserver la valorisation d'achat existante, comme le calcul canonique.
  IF EXISTS (SELECT 1 FROM public.recipes WHERE product_id = p_product_id AND is_active AND deleted_at IS NULL) THEN
    IF v_cost IS NULL OR v_cost < 0 OR v_cost > 5000000 OR v_cost = 'NaN'::numeric THEN
      RAISE EXCEPTION 'recipe_cost_out_of_range' USING ERRCODE = '22003';
    END IF;
    IF v_old IS DISTINCT FROM v_cost THEN
      -- Le déclencheur appelant traite déjà tous les parents : éviter les snapshots doublons.
      PERFORM set_config('breakery.recipe_cost_refresh', 'on', true);
      UPDATE public.products SET cost_price = v_cost, updated_at = now() WHERE id = p_product_id;
      PERFORM set_config('breakery.recipe_cost_refresh', coalesce(v_previous, ''), true);
      INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (p_profile, 'product.cost_recomputed', 'product', p_product_id,
          jsonb_build_object('old_cost', v_old, 'new_cost', v_cost, 'source', 'recipe_edit',
            'recipe_version_id', v_version));
    END IF;
  END IF;
  PERFORM public._refresh_recipe_margin(p_product_id, v_cost);
  RETURN v_version;
END $function$;

CREATE OR REPLACE FUNCTION public.tr_snapshot_recipe_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id UUID; v_action TEXT; v_profile UUID; v_product_name TEXT; v_ancestor RECORD; v_alive BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN v_product_id := OLD.product_id; v_action := 'delete';
  ELSE v_product_id := NEW.product_id; v_action := lower(TG_OP); END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;

  SELECT (deleted_at IS NULL) INTO v_alive FROM products WHERE id = v_product_id;
  IF COALESCE(v_alive, FALSE) THEN
    PERFORM _snapshot_recipe_and_refresh_cost(v_product_id, v_action, v_profile);
  END IF;

  SELECT name INTO v_product_name FROM products WHERE id = v_product_id;

  FOR v_ancestor IN
    WITH RECURSIVE ancestors AS (
      SELECT DISTINCT r.product_id FROM recipes r
       WHERE r.material_id = v_product_id AND r.is_active = TRUE AND r.deleted_at IS NULL
      UNION
      SELECT DISTINCT r.product_id FROM recipes r JOIN ancestors a ON r.material_id = a.product_id
       WHERE r.is_active = TRUE AND r.deleted_at IS NULL
    )
    SELECT a.product_id FROM ancestors a JOIN products p ON p.id = a.product_id WHERE p.deleted_at IS NULL
  LOOP
    PERFORM _snapshot_recipe_and_refresh_cost(v_ancestor.product_id,
      'cascade: ' || COALESCE(v_product_name, v_product_id::TEXT) || ' changed', v_profile);
  END LOOP;

  RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION public.tr_snapshot_on_product_cost_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile UUID; v_change_note TEXT; v_ancestor RECORD;
BEGIN
  IF current_setting('breakery.recipe_cost_refresh', true) = 'on' THEN RETURN NULL; END IF;
  IF OLD.cost_price IS NOT DISTINCT FROM NEW.cost_price THEN RETURN NULL; END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;

  v_change_note := format('material price update: %s %s→%s', NEW.name,
    COALESCE(OLD.cost_price::TEXT, 'NULL'), COALESCE(NEW.cost_price::TEXT, 'NULL'));

  FOR v_ancestor IN
    WITH RECURSIVE ancestors AS (
      SELECT DISTINCT r.product_id FROM recipes r
       WHERE r.material_id = NEW.id AND r.is_active = TRUE AND r.deleted_at IS NULL
      UNION
      SELECT DISTINCT r.product_id FROM recipes r JOIN ancestors a ON r.material_id = a.product_id
       WHERE r.is_active = TRUE AND r.deleted_at IS NULL
    )
    SELECT a.product_id FROM ancestors a JOIN products p ON p.id = a.product_id WHERE p.deleted_at IS NULL
  LOOP
    PERFORM _snapshot_recipe_and_refresh_cost(v_ancestor.product_id, v_change_note, v_profile);
  END LOOP;

  RETURN NULL;
END $function$
;
CREATE OR REPLACE FUNCTION public.tr_refresh_recipe_margin_on_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._refresh_recipe_margin(NEW.id,
    coalesce((public._calculate_recipe_cost_walk(NEW.id, 5, 1, ARRAY[]::uuid[])->>'cost_per_unit')::numeric, 0));
  RETURN NULL;
END $function$;
CREATE TRIGGER tr_products_refresh_recipe_margin
AFTER UPDATE OF retail_price, target_gross_margin_pct ON public.products
FOR EACH ROW WHEN (OLD.retail_price IS DISTINCT FROM NEW.retail_price
  OR OLD.target_gross_margin_pct IS DISTINCT FROM NEW.target_gross_margin_pct)
EXECUTE FUNCTION public.tr_refresh_recipe_margin_on_price();

REVOKE ALL ON FUNCTION public._refresh_recipe_margin(uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._snapshot_recipe_and_refresh_cost(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tr_snapshot_recipe_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tr_snapshot_on_product_cost_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tr_refresh_recipe_margin_on_price() FROM PUBLIC, anon, authenticated;
-- Privilèges par défaut déjà révoqués à PUBLIC en base : aucun changement global d'ACL.
DO $cron$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname IN
    ('recompute-recipe-costs-daily', 'recompute-recipe-margins-daily')
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END $cron$;

