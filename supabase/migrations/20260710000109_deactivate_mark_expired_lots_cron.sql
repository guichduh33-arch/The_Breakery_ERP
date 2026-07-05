-- S61 (06 D3.1) : décision propriétaire 2026-07-04 — pas de péremption/FIFO stock.
-- Désactive le job pg_cron mark_expired_lots_hourly (jobid résolu par nom, pas de DROP :
-- la fonction et stock_lots restent dormantes ; réactivation = active := true).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'mark_expired_lots_hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, active := false);
  END IF;
END $$;
