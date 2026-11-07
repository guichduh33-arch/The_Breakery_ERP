-- Les API natives historiques ne doivent pas contourner les frontières antifraude.
-- Les versions courantes sont déjà créées par le lot principal ; aucun CASCADE.
DO $retire$
DECLARE f record;
BEGIN
 IF (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('record_batch_production_v12','record_kitchen_production_v5','record_production_v10','get_pos_order_snapshot_v5','reopen_held_order_v10','pay_existing_order_v25'))<>6
   OR to_regprocedure('public.can_view_stock_v1()') IS NULL THEN
  RAISE EXCEPTION 'antifraud_replacements_required_before_retirement';
 END IF;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('record_batch_production_v10','record_kitchen_production_v3','record_production_v8','get_pos_order_snapshot_v3','reopen_held_order_v7','pay_existing_order_v23') LOOP
  EXECUTE format('DROP FUNCTION %s',f.signature);
 END LOOP;
END $retire$;
