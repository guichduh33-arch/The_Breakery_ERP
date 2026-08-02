-- Lot 1 — Les partitions de pos_events etaient ouvertes en lecture et en ecriture.
--
-- Le parent (20260710000155) est correctement ferme : RLS active, policy de
-- lecture gatee sur reports.audit.read, REVOKE INSERT/UPDATE/DELETE a
-- authenticated. Mais en PostgreSQL, une table creee par CREATE TABLE ...
-- PARTITION OF n herite NI de RLS NI des GRANT de son parent : elle nait avec
-- RLS desactive et les privileges par defaut du schema. PostgREST expose ensuite
-- chaque partition comme une table a part entiere.
--
-- Consequence mesuree avant ce correctif, sous le role authenticated sans la
-- permission reports.audit.read :
--   SELECT count(*) FROM public.pos_events            -> 0     (policy respectee)
--   SELECT count(*) FROM public.pos_events_2026_07    -> 1203  (journal expose)
--   SELECT count(*) FROM public.pos_events_2026_08    -> 10
-- Soit la totalite du journal d audit POS lisible par n importe quel utilisateur
-- connecte, et des evenements forgeables par INSERT direct sur la partition.
-- UPDATE et DELETE restaient bloques par les triggers pos_events_no_update /
-- pos_events_no_delete, herites eux (triggers ROW), ce qui masquait le trou.
--
-- Verifie en transaction : activer RLS sur une partition ne casse pas la lecture
-- via le parent (les policies du parent continuent de s appliquer) ; seule
-- l attaque directe sur la partition est fermee.
--
-- service_role n est pas touche : il porte les Edge Functions et bypasse RLS.

ALTER TABLE public.pos_events_2026_07 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_events_2026_08 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_events_2026_09 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_events_default ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pos_events_2026_07 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pos_events_2026_08 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pos_events_2026_09 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.pos_events_default FROM PUBLIC, anon, authenticated;

-- Sans ce helper, le correctif expire a la prochaine partition : celle de
-- 2026-10 naitrait ouverte comme les precedentes. La regle « une partition nait
-- fermee » devient executable au lieu de dependre de la vigilance de qui
-- ecrira la prochaine migration.
CREATE OR REPLACE FUNCTION public.create_pos_events_partition_v1(p_month date)
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

  -- Ni RLS ni les GRANT ne s heritent du parent : on les pose explicitement.
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_name);

  RETURN v_name || ' (creee et fermee)';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_pos_events_partition_v1(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_pos_events_partition_v1(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_pos_events_partition_v1(date) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.create_pos_events_partition_v1(date) IS
  'Cree la partition mensuelle de pos_events couvrant p_month et la ferme (RLS active, aucun GRANT a anon/authenticated). Seul chemin autorise pour ajouter une partition : les partitions n heritent ni de RLS ni des GRANT du parent. Administrateur uniquement.';
