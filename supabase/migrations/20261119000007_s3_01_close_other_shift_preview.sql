-- S3-01 — Clôturer la session d'un autre caissier (décision de Mamat du
-- 2026-11-19, ADR-043). Avec une session par terminal, un caissier qui oublie de
-- clôturer bloque le terminal ; un utilisateur qui détient
-- pos.session.close_other compte et clôture cette session depuis le POS.
-- close_shift_v15 porte la même garde.
--
-- Partie ADDITIVE : get_shift_close_preview_v2 = v1 + accès à la session ouverte
-- d'un autre pour qui détient pos.session.close_other. Corps repris du vivant
-- (pg_get_functiondef) du 2026-11-19. La v1 se retire avec close_shift_v14,
-- après l'installation du paquet caisse.
CREATE FUNCTION public.get_shift_close_preview_v2(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_snapshot jsonb; v_config business_config;
BEGIN
 -- v2 (S3-01) : sa propre session ouverte, ou celle d'un autre avec pos.session.close_other.
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM pos_sessions s JOIN user_profiles u ON u.id=s.opened_by
   WHERE s.id=p_session_id AND s.status='open'
     AND ((u.auth_user_id=auth.uid() AND u.deleted_at IS NULL)
          OR public.has_permission(auth.uid(), 'pos.session.close_other'))) THEN
   RAISE EXCEPTION 'no_open_shift' USING ERRCODE='P0001'; END IF;
 v_snapshot:=public._build_zreport_snapshot(p_session_id);
 SELECT * INTO v_config FROM business_config WHERE id=1;
 RETURN jsonb_build_object(
   'expectedCash',coalesce((v_snapshot->>'opening_cash')::numeric,0)+coalesce((v_snapshot->'totals_by_payment_method'->>'cash')::numeric,0)
     +coalesce((v_snapshot->>'cash_in_total')::numeric,0)-coalesce((v_snapshot->>'cash_out_total')::numeric,0),
   'thresholdAbs',coalesce(v_config.shift_variance_threshold_abs,50000),
   'thresholdPct',coalesce(v_config.shift_variance_threshold_pct,0.005),
   'pinThresholdAbs',coalesce(v_config.shift_variance_pin_threshold_abs,200000),
   'pinThresholdPct',coalesce(v_config.shift_variance_pin_threshold_pct,0.02));
END $function$;

REVOKE ALL ON FUNCTION public.get_shift_close_preview_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shift_close_preview_v2(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shift_close_preview_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_close_preview_v2(uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
