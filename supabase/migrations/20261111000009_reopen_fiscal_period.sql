-- S1-03 — Réouverture d'une période fiscale.
--
-- Le contrôle de période (`check_fiscal_period_open`) est appelé par tous les
-- émetteurs d'écriture, vente comprise : clôturer le mois en cours arrête la
-- caisse, et rien ne savait rouvrir. Cette fonction rend le geste réversible
-- tant que la période est `closed`.
--
-- Règles :
--   * réservée au propriétaire (`is_business_owner_v1`), sous PIN avec
--     verrouillage ; un PIN faux RETOURNE un refus pour que le compteur
--     d'échecs soit commité (même contrat que la clôture) ;
--   * `closed` -> `open` uniquement. `locked` reste irréversible ;
--   * refusée si l'exercice porte déjà son écriture de clôture annuelle : une
--     écriture de résultat passée après le report à nouveau fausserait 3200 ;
--   * trace dans `audit_logs`, `actor_id` = profil.

CREATE FUNCTION public.reopen_fiscal_period_v1(
  p_period_id   uuid,
  p_manager_pin text,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_period  RECORD;
  v_reason  TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT public.is_business_owner_v1() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_period.status = 'locked' THEN
    RAISE EXCEPTION 'period_locked_irreversible' USING ERRCODE = 'P0003';
  END IF;
  IF v_period.status <> 'closed' THEN
    RAISE EXCEPTION 'period_not_closed' USING ERRCODE = 'P0003';
  END IF;

  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE reference_type = 'year_close'
                AND entry_date = make_date(EXTRACT(YEAR FROM v_period.period_end)::int, 12, 31)
                AND status IN ('posted','locked')) THEN
    RAISE EXCEPTION 'fiscal_year_already_closed' USING ERRCODE = 'P0003';
  END IF;

  UPDATE fiscal_periods
     SET status = 'open',
         closed_by = NULL,
         closed_at = NULL
   WHERE id = p_period_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'accounting.period.reopened',
    'fiscal_periods',
    p_period_id,
    jsonb_build_object(
      'period_start',       v_period.period_start,
      'period_end',         v_period.period_end,
      'old_status',         v_period.status,
      'new_status',         'open',
      'previous_closed_by', v_period.closed_by,
      'previous_closed_at', v_period.closed_at,
      'reason',             v_reason
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'period_id',    p_period_id,
    'period_start', v_period.period_start,
    'period_end',   v_period.period_end,
    'new_status',   'open',
    'reopened_at',  now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_fiscal_period_v1(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_fiscal_period_v1(uuid, text, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
