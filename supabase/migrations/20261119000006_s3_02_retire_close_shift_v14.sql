-- S3-02, partie RETRAIT. À appliquer en production APRÈS l'installation du
-- paquet caisse qui appelle close_shift_v15 et get_pos_sessions_report_v5 :
-- l'ancien paquet appelle encore les versions retirées ici.
--
-- Une clôture par close_shift_v14 ne figerait pas les totaux (S3-02) et ne
-- saurait pas reclôturer une session rouverte (S3-03) : elle se retire, comme
-- le veut le versionnement monotone des fonctions.
DROP FUNCTION IF EXISTS public.close_shift_v14(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb);
DROP FUNCTION IF EXISTS public.get_pos_sessions_report_v4(date, date);

-- Les versions plus anciennes encore présentes (relevé du 2026-11-19 : v10,
-- v12 et v13 en production, v10 à v13 en dev) précèdent ce chantier, et des
-- tests pgTAP les appellent encore en propriétaire de la base. Aucun appelant
-- applicatif. Elles restent, mais perdent leur droit d'exécution côté client :
-- sans cela, un client clôturerait encore sans figer les totaux.
DO $retire$
DECLARE r regprocedure;
BEGIN
  FOR r IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('close_shift_v10', 'close_shift_v11', 'close_shift_v12', 'close_shift_v13')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r);
  END LOOP;
END
$retire$;
