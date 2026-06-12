-- 20260626000017_fix_row_to_jsonb_dashboard_aggregates.sql
-- Corrective trouvée par l'E2E D3 (audit 2026-06-12) : `row_to_jsonb(record)`
-- n'existe pas en Postgres (c'est `to_jsonb`). get_product_dashboard_v1
-- (6 sites) et get_movement_aggregates_v1 (1 site) plantaient en 42883 au
-- premier appel réel — invisibles tant que C1 (hooks rpc non liés) tuait les
-- pages appelantes avant tout round-trip. Signatures inchangées.

DO $do$
DECLARE
  v_def TEXT;
  v_fn  TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['get_product_dashboard_v1', 'get_movement_aggregates_v1'] LOOP
    SELECT pg_get_functiondef(('public.' || v_fn)::regproc) INTO v_def;
    IF position('row_to_jsonb' in v_def) = 0 THEN
      CONTINUE;  -- déjà appliqué (idempotent)
    END IF;
    v_def := replace(v_def, 'row_to_jsonb(', 'to_jsonb(');
    EXECUTE v_def;
  END LOOP;
END $do$;
