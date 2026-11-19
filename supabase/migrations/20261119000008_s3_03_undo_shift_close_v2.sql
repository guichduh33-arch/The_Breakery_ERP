-- S3-03 — undo_shift_close_v2 : l'annulation de clôture fonctionne aussi là où
-- le suivi du tiroir n'existe pas.
--
-- Écart constaté le 2026-11-19 au relevé de la production, avant livraison :
-- la migration 20261030000007_shift_cash_drawer.sql (compte « Cash Drawer » 1119,
-- table shift_cash_treasury, émission du fond et règlement du tiroir) est
-- appliquée en dev, jamais en production. La v1 déclarait une variable du type
-- de cette table : en production elle ne peut pas s'exécuter.
--
-- La v2 lit et remet à zéro le suivi du tiroir seulement si la table existe
-- (requêtes dynamiques). Sans elle, il n'y a ni règlement à contre-passer ni
-- argent déposé à contrôler : l'annulation contre-passe l'écart, retire le
-- rapport Z brouillon et rouvre la session. Tout le reste est inchangé.
-- La v1 n'a jamais été appliquée en production ; elle se retire ici.
CREATE FUNCTION public.undo_shift_close_v2(
  p_session_id  uuid,
  p_manager_pin text,
  p_reason      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   uuid;
  v_reason    text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_s         pos_sessions%ROWTYPE;
  v_z         z_reports%ROWTYPE;
  v_has_z     boolean;
  v_has_t     boolean := false;
  v_t_settle  uuid;
  v_t_deposit numeric;
  v_t_row     jsonb;
  v_rows      integer;
  v_var_je    uuid;
  v_var_rev   uuid;
  v_set_rev   uuid;
  v_undeposited numeric;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_manager_pin), '') = '' THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL AND is_active
   LIMIT 1;
  IF v_profile IS NULL OR NOT public.is_business_owner_v1() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  -- Un PIN faux se RETOURNE au lieu de lever : le compteur de verrouillage
  -- incrémenté par _verify_pin_with_lockout doit survivre à la réponse.
  IF p_manager_pin !~ '^\d{6}$'
     OR NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  SELECT * INTO v_s FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_s.status <> 'closed' THEN
    RAISE EXCEPTION 'session_not_closed' USING ERRCODE = 'P0001';
  END IF;
  IF v_s.terminal_id IS NULL THEN
    RAISE EXCEPTION 'terminal_unknown' USING ERRCODE = 'P0001';
  END IF;
  -- Même verrou que open_shift_v1 : une ouverture sur ce terminal attend.
  PERFORM 1 FROM lan_devices WHERE id = v_s.terminal_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM pos_sessions
              WHERE terminal_id = v_s.terminal_id
                AND id <> v_s.id
                AND opened_at > v_s.opened_at) THEN
    RAISE EXCEPTION 'session_not_last' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pos_sessions
              WHERE opened_by = v_s.opened_by AND status = 'open') THEN
    RAISE EXCEPTION 'user_session_open' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_z FROM z_reports WHERE shift_id = v_s.id FOR UPDATE;
  v_has_z := FOUND;
  IF v_has_z AND v_z.status <> 'draft' THEN
    RAISE EXCEPTION 'zreport_not_draft' USING ERRCODE = 'P0001';
  END IF;

  -- 1. L'écriture d'écart.
  SELECT je.id INTO v_var_je
    FROM journal_entries je
   WHERE je.reference_type = 'shift_close' AND je.reference_id = v_s.id
     AND NOT (COALESCE(je.metadata, '{}'::jsonb) ? 'reverses')
     AND NOT EXISTS (SELECT 1 FROM journal_entries rv
                      WHERE rv.metadata->>'reverses' = je.id::text)
   LIMIT 1;
  IF v_var_je IS NOT NULL THEN
    v_var_rev := public._reverse_shift_journal_entry_v1(
      v_var_je, 'Shift close variance reversed (close undone, session ' || v_s.id::text || ')',
      v_profile, jsonb_build_object('kind', 'shift_close_reversal', 'session_id', v_s.id));
  END IF;

  -- 2. Le règlement du tiroir, s'il existe. Décision de Mamat du 2026-11-19 :
  -- si l'argent déposé en fonds non déposés en est déjà sorti (dépôt en banque,
  -- retrait), l'annulation est refusée ; la contre-passation rendrait ce compte
  -- négatif.
  IF to_regclass('public.shift_cash_treasury') IS NOT NULL THEN
    EXECUTE 'SELECT t.settlement_je_id, t.safe_deposit, to_jsonb(t)
               FROM public.shift_cash_treasury t WHERE t.session_id = $1 FOR UPDATE'
       INTO v_t_settle, v_t_deposit, v_t_row USING v_s.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_has_t := v_rows > 0;
  END IF;
  IF v_has_t AND v_t_settle IS NOT NULL AND COALESCE(v_t_deposit, 0) > 0 THEN
    SELECT COALESCE(SUM(l.debit - l.credit), 0) INTO v_undeposited
      FROM journal_entry_lines l
      JOIN journal_entries j ON j.id = l.journal_entry_id
     WHERE l.account_id = resolve_mapping_account('CASH_WALLET_UNDEPOSITED')
       AND j.status IN ('posted', 'locked');
    IF v_undeposited < v_t_deposit THEN
      RAISE EXCEPTION 'undeposited_cash_moved' USING ERRCODE = 'P0001',
        DETAIL = format('undeposited balance %s is below the %s this close deposited', v_undeposited, v_t_deposit);
    END IF;
  END IF;
  IF v_has_t AND v_t_settle IS NOT NULL THEN
    v_set_rev := public._reverse_shift_journal_entry_v1(
      v_t_settle, 'Shift cash settlement reversed (close undone)',
      v_profile, jsonb_build_object('kind', 'shift_cash_settlement_reversal',
                                    'session_id', v_s.id));
  END IF;
  IF v_has_t THEN
    EXECUTE 'UPDATE public.shift_cash_treasury
                SET settlement_je_id = NULL, settled_at = NULL,
                    returned_float = NULL, safe_deposit = NULL
              WHERE session_id = $1' USING v_s.id;
  END IF;

  -- 3. Le rapport Z brouillon.
  IF v_has_z THEN
    DELETE FROM z_reports WHERE id = v_z.id;
  END IF;

  -- 4. La session.
  UPDATE pos_sessions
     SET status = 'open',
         closed_at = NULL, closed_by = NULL,
         closing_cash = NULL, expected_cash = NULL, variance_total = NULL,
         closing_notes = NULL, variance_approved_by = NULL,
         counted_qris = NULL, counted_card = NULL, closing_denominations = NULL,
         closing_payment_totals = NULL, closing_sales_total = NULL,
         closing_order_count = NULL
   WHERE id = v_s.id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, payload, actor_id)
  VALUES (
    'shift.close_undone', 'pos_sessions', v_s.id,
    jsonb_build_object(
      'reason',                   v_reason,
      'terminal_id',              v_s.terminal_id,
      'variance_journal_entry',   v_var_je,
      'variance_reversal_entry',  v_var_rev,
      'settlement_journal_entry', v_t_settle,
      'settlement_reversal_entry', v_set_rev,
      'zreport_id',               CASE WHEN v_has_z THEN v_z.id END
    ),
    jsonb_build_object(
      'before',  to_jsonb(v_s),
      'zreport', CASE WHEN v_has_z THEN to_jsonb(v_z) END,
      'treasury', v_t_row
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'ok',                        true,
    'session_id',                v_s.id,
    'status',                    'open',
    'variance_reversal_entry',   v_var_rev,
    'settlement_reversal_entry', v_set_rev,
    'zreport_removed',           v_has_z
  );
END;
$function$;

COMMENT ON FUNCTION public.undo_shift_close_v2(uuid, text, text) IS
  'S3-03 — le propriétaire annule la dernière clôture d''un terminal tant que son '
  'rapport Z est un brouillon. Refus : forbidden, pin_required, invalid_pin (retour), '
  'session_not_found, session_not_closed, terminal_unknown, session_not_last, '
  'user_session_open, zreport_not_draft, undeposited_cash_moved.';

REVOKE ALL ON FUNCTION public.undo_shift_close_v2(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_shift_close_v2(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_shift_close_v2(uuid, text, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION IF EXISTS public.undo_shift_close_v1(uuid, text, text);
