-- 20260519000142_pg_cron_recompute_margins.sql
-- Session 15 / Phase 5.A — recompute_recipe_margins_v1 RPC + pg_cron job.
--
-- Iterates every product with target_gross_margin_pct IS NOT NULL and an
-- active recipe ; computes expected margin from calculate_recipe_cost_v1's
-- internal walker (we bypass the public RPC's permission check by calling
-- _calculate_recipe_cost_walk directly — legitimate since this function is
-- SECURITY DEFINER owned by postgres, which already has execute on the
-- helper after migration 20260519000020 revoked it from authenticated).
--
-- Behaviour :
--   - expected_margin_pct = (price - cost) / price * 100
--   - If expected < target : OPEN or UPDATE the open alert row.
--   - If expected >= target : AUTO-RECOVER any open alert (acknowledged_at
--     = now(), notes = 'auto-recovered').
--   - One audit_log row written per run for observability.
--
-- pg_cron : 'recompute-recipe-margins-daily' at 02:00 UTC (mirrors the
-- birthday-notify pattern from 20260517000222_init_birthday_cron.sql).

CREATE OR REPLACE FUNCTION public.recompute_recipe_margins_v1()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now              TIMESTAMPTZ := now();
  v_checked          INT := 0;
  v_opened           INT := 0;
  v_updated          INT := 0;
  v_recovered        INT := 0;
  v_prod             RECORD;
  v_cost_walk        JSONB;
  v_cost_per_unit    DECIMAL(14,4);
  v_expected_margin  DECIMAL(7,2);
  v_delta            DECIMAL(7,2);
  v_existing_id      UUID;
  v_result           JSONB;
BEGIN
  FOR v_prod IN
    SELECT p.id, p.name, p.retail_price, p.target_gross_margin_pct
      FROM public.products p
     WHERE p.deleted_at IS NULL
       AND p.target_gross_margin_pct IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.recipes r
          WHERE r.product_id = p.id
            AND r.is_active = TRUE
            AND r.deleted_at IS NULL
       )
  LOOP
    -- Skip products with no usable selling price.
    IF v_prod.retail_price IS NULL OR v_prod.retail_price <= 0 THEN
      CONTINUE;
    END IF;

    v_checked := v_checked + 1;

    BEGIN
      v_cost_walk := public._calculate_recipe_cost_walk(v_prod.id, 5, 1, ARRAY[]::UUID[]);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'recompute_recipe_margins_v1: skip % (cost walk failed: %)',
        v_prod.id, SQLERRM;
      CONTINUE;
    END;

    v_cost_per_unit  := COALESCE((v_cost_walk->>'cost_per_unit')::DECIMAL(14,4), 0);
    v_expected_margin := ROUND(
      ((v_prod.retail_price - v_cost_per_unit) / v_prod.retail_price * 100.0)::numeric,
      2
    );
    v_delta := ROUND((v_expected_margin - v_prod.target_gross_margin_pct)::numeric, 2);

    SELECT id INTO v_existing_id
      FROM public.margin_alerts
     WHERE product_id = v_prod.id
       AND acknowledged_at IS NULL
     LIMIT 1;

    IF v_expected_margin < v_prod.target_gross_margin_pct THEN
      -- Breach : open or update.
      IF v_existing_id IS NULL THEN
        INSERT INTO public.margin_alerts (
          product_id, expected_margin_pct, target_margin_pct, delta_pct,
          cost_per_unit, selling_price, computed_at
        ) VALUES (
          v_prod.id, v_expected_margin, v_prod.target_gross_margin_pct, v_delta,
          v_cost_per_unit, v_prod.retail_price, v_now
        );
        v_opened := v_opened + 1;
      ELSE
        UPDATE public.margin_alerts
           SET expected_margin_pct = v_expected_margin,
               target_margin_pct   = v_prod.target_gross_margin_pct,
               delta_pct           = v_delta,
               cost_per_unit       = v_cost_per_unit,
               selling_price       = v_prod.retail_price,
               computed_at         = v_now
         WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      END IF;
    ELSE
      -- Recovered : if an open alert exists, auto-close it.
      IF v_existing_id IS NOT NULL THEN
        UPDATE public.margin_alerts
           SET acknowledged_at = v_now,
               notes           = COALESCE(notes, '') ||
                 CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                 'auto-recovered',
               computed_at     = v_now
         WHERE id = v_existing_id;
        v_recovered := v_recovered + 1;
      END IF;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'checked',           v_checked,
    'alerts_opened',     v_opened,
    'alerts_updated',    v_updated,
    'alerts_recovered',  v_recovered,
    'ran_at',            v_now
  );

  -- Audit row for observability. Wrapped so audit-log shape changes do not
  -- break the cron.
  BEGIN
    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (NULL, 'margin.recomputed', 'margin_alerts', NULL, v_result);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_recipe_margins_v1: audit log failed: %', SQLERRM;
  END;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.recompute_recipe_margins_v1() FROM public;
GRANT  EXECUTE ON FUNCTION public.recompute_recipe_margins_v1() TO authenticated, service_role;

COMMENT ON FUNCTION public.recompute_recipe_margins_v1() IS
  'Session 15 / Phase 5.A. Recomputes expected gross margin for each product with target_gross_margin_pct set + active recipe ; opens / updates / auto-recovers rows in margin_alerts. Runs daily via pg_cron job recompute-recipe-margins-daily. Returns jsonb { checked, alerts_opened, alerts_updated, alerts_recovered, ran_at }.';

-- ──────────────────────────────────────────────────────────────────────────
-- pg_cron schedule — mirrors the birthday-notify-daily pattern.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('recompute-recipe-margins-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

SELECT cron.schedule(
  'recompute-recipe-margins-daily',
  '0 2 * * *',  -- 02:00 UTC daily
  $cron$SELECT public.recompute_recipe_margins_v1();$cron$
);
