-- S3-02, partie RETRAIT. À appliquer en production APRÈS l'installation du
-- paquet caisse qui appelle close_shift_v15 et get_pos_sessions_report_v5 :
-- l'ancien paquet appelle encore les versions retirées ici.
--
-- Une clôture par close_shift_v14 ne figerait pas les totaux (S3-02) et ne
-- saurait pas reclôturer une session rouverte (S3-03) : elle se retire, comme
-- le veut le versionnement monotone des fonctions.
--
-- close_shift_v10 et close_shift_v13 sont des enveloppes de compatibilité : elles
-- transmettent l'appel à la version courante (relevé du corps vivant du
-- 2026-11-19, production et dev). Elles suivent désormais close_shift_v15, qui
-- fige les totaux ; leur en-tête et leurs droits ne changent pas.
CREATE OR REPLACE FUNCTION public.close_shift_v10(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_approver_id uuid DEFAULT NULL::uuid, p_manager_pin text DEFAULT NULL::text, p_counted_qris numeric DEFAULT NULL::numeric, p_counted_card numeric DEFAULT NULL::numeric, p_denominations jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.close_shift_v15(p_session_id,p_counted_cash,p_notes,p_idempotency_key,p_approver_id,p_manager_pin,
   p_counted_qris,p_counted_card,p_denominations);
$function$;

CREATE OR REPLACE FUNCTION public.close_shift_v13(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_approver_id uuid DEFAULT NULL::uuid, p_manager_pin text DEFAULT NULL::text, p_counted_qris numeric DEFAULT NULL::numeric, p_counted_card numeric DEFAULT NULL::numeric, p_denominations jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.close_shift_v15(p_session_id,p_counted_cash,p_notes,p_idempotency_key,p_approver_id,p_manager_pin,
   p_counted_qris,p_counted_card,p_denominations);
$function$;

DROP FUNCTION IF EXISTS public.close_shift_v14(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb);
DROP FUNCTION IF EXISTS public.get_pos_sessions_report_v4(date, date);
-- Remplacée par get_shift_close_preview_v2 (migration 20261119000007).
DROP FUNCTION IF EXISTS public.get_shift_close_preview_v1(uuid);

-- close_shift_v11 (dev seulement) et close_shift_v12 portent un corps complet
-- antérieur, qui clôturerait sans figer les totaux. Des tests pgTAP les appellent
-- encore en propriétaire de la base ; aucun appelant applicatif. Elles restent,
-- mais perdent leur droit d'exécution côté client.
DO $retire$
DECLARE r regprocedure;
BEGIN
  FOR r IN SELECT p.oid::regprocedure FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('close_shift_v11', 'close_shift_v12')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r);
  END LOOP;
END
$retire$;
