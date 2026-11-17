-- S1-16 — Régulariser le partitionnement du journal du POS.
--
-- Les partitions mensuelles de `pos_events` s'arrêtent à septembre 2026 : depuis
-- octobre, tout part dans la partition par défaut. Créer la partition d'un mois
-- échoue dès que la partition par défaut porte des lignes de ce mois. Relevé du
-- 2026-11-18 : 22 889 lignes en production (octobre et novembre), 212 en dev.
--
-- Méthode, dans une seule transaction :
--   1. détacher la partition par défaut et la mettre de côté ;
--   2. créer les partitions d'octobre 2026 à février 2027 par le seul chemin
--      autorisé, `create_pos_events_partition_v1` (RLS active, aucun droit
--      pour anon ni authenticated) ;
--   3. recréer une partition par défaut vide, fermée de la même façon ;
--   4. réinsérer les lignes par le parent : chacune rejoint sa partition ;
--   5. vérifier le comptage, puis supprimer l'ancienne table par DROP.
-- Aucune ligne n'est supprimée une à une : le journal est en ajout seul (ses
-- déclencheurs refusent UPDATE et DELETE), et la purge prévue est déjà un DROP
-- de partition. L'insertion repasse par les déclencheurs d'INSERT du parent ;
-- il n'y en a aucun (relevé du 2026-11-18 : seulement `pos_events_no_update`
-- et `pos_events_no_delete`).
--
-- Le détachement prend un verrou exclusif sur `pos_events` le temps de la
-- transaction : une vente qui écrit son journal attend. À appliquer boutique
-- fermée.
--
-- Une tâche planifiée crée ensuite à l'avance les partitions des deux mois
-- suivants, le 20 de chaque mois. Elle n'appelle aucune Edge Function : elle ne
-- dépend ni d'une adresse de projet ni d'un secret (S1-14).

DO $s116$
DECLARE
  v_before bigint;
  v_after  bigint;
  v_left   bigint;
  v_month  date;
BEGIN
  SELECT count(*) INTO v_before FROM public.pos_events;

  ALTER TABLE public.pos_events DETACH PARTITION public.pos_events_default;
  ALTER TABLE public.pos_events_default RENAME TO pos_events_default_s116;

  FOR v_month IN SELECT generate_series(date '2026-10-01', date '2027-02-01', interval '1 month')::date LOOP
    PERFORM public.create_pos_events_partition_v1(v_month);
  END LOOP;

  CREATE TABLE public.pos_events_default PARTITION OF public.pos_events DEFAULT;
  ALTER TABLE public.pos_events_default ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.pos_events_default FROM PUBLIC, anon, authenticated;

  INSERT INTO public.pos_events SELECT * FROM public.pos_events_default_s116;

  SELECT count(*) INTO v_after FROM public.pos_events;
  SELECT count(*) INTO v_left FROM public.pos_events_default;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 's1_16: % lignes avant, % après', v_before, v_after;
  END IF;
  RAISE NOTICE 's1_16: % lignes replacées, % restent dans la partition par défaut', v_after, v_left;

  DROP TABLE public.pos_events_default_s116;
END $s116$;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('pos-events-partitions-ahead')
      FROM cron.job WHERE jobname = 'pos-events-partitions-ahead';
    PERFORM cron.schedule('pos-events-partitions-ahead', '0 3 20 * *',
      $job$ SELECT public.create_pos_events_partition_v1((now() + interval '1 month')::date),
                   public.create_pos_events_partition_v1((now() + interval '2 months')::date); $job$);
  END IF;
END $cron$;
