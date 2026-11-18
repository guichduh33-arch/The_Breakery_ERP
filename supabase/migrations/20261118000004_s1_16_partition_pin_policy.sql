-- S1-16, suite — une partition du journal du POS naît aussi avec la règle PIN.
--
-- Depuis 20261020000005_enforce_pin_sessions.sql, chaque table publique sous
-- RLS porte la règle restrictive `pin_session_required` pour `authenticated`.
-- Les partitions de juillet à septembre 2026 l'ont reçue ce jour-là. Celles
-- créées par `create_pos_events_partition_v1` (20261118000003) ne l'ont pas :
-- la fonction est antérieure à cette règle et ne la pose pas. La garde pgTAP
-- `pin_session_enforcement` les compte (6 tables sans la règle).
--
-- Trois gestes :
--   1. `create_pos_events_partition_v2` : même création fermée, plus la règle PIN ;
--   2. la règle posée sur chaque partition du journal qui ne l'a pas ;
--   3. la tâche planifiée appelle la v2, et la v1 est retirée.

CREATE FUNCTION public.create_pos_events_partition_v2(p_month date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'pos_events_' || to_char(v_start, 'YYYY_MM');
BEGIN
  IF to_regclass('public.' || v_name) IS NOT NULL THEN
    RETURN v_name || ' (deja presente)';
  END IF;

  EXECUTE format(
    'CREATE TABLE public.%I PARTITION OF public.pos_events FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end);

  -- Ni RLS, ni les GRANT, ni les règles ne s'héritent du parent : on les pose.
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_name);
  EXECUTE format(
    'CREATE POLICY pin_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()))',
    v_name);

  RETURN v_name || ' (creee et fermee)';
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pos_events_partition_v2(date) FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.create_pos_events_partition_v2(date) IS
  'Cree la partition mensuelle de pos_events couvrant p_month et la ferme (RLS active, aucun GRANT a anon/authenticated, regle pin_session_required). Seul chemin autorise pour ajouter une partition. Administrateur uniquement.';

DO $pin$
DECLARE v_part record;
BEGIN
  FOR v_part IN
    SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.pos_events'::regclass
      AND NOT EXISTS (SELECT 1 FROM pg_policy p
        WHERE p.polrelid = c.oid AND p.polname = 'pin_session_required')
  LOOP
    EXECUTE format(
      'CREATE POLICY pin_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()))',
      v_part.relname);
  END LOOP;
END $pin$;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('pos-events-partitions-ahead')
      FROM cron.job WHERE jobname = 'pos-events-partitions-ahead';
    PERFORM cron.schedule('pos-events-partitions-ahead', '0 3 20 * *',
      $job$ SELECT public.create_pos_events_partition_v2((now() + interval '1 month')::date),
                   public.create_pos_events_partition_v2((now() + interval '2 months')::date); $job$);
  END IF;
END $cron$;

DROP FUNCTION public.create_pos_events_partition_v1(date);
