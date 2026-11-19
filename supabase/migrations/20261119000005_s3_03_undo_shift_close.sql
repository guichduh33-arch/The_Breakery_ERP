-- S3-03 — Annuler la dernière clôture de session (master plan de finition,
-- arbitrage §2bis lot 5, décision C04 ; RÈGLE de SPECS_OFFICIELS_ERP_POS.md §6.3).
--
-- Décision C04 : une fonction réservée au propriétaire contre-passe l'écriture
-- d'écart et remet la session en open, avec une trace dans audit_logs.
-- Précisions de Mamat du 2026-11-19 :
--   - « la dernière » s'entend PAR TERMINAL : aucune session plus récente ne
--     doit avoir été ouverte sur le terminal de la session ;
--   - un rapport Z déjà SIGNÉ interdit l'annulation : elle ne vaut que tant que
--     le rapport Z est un brouillon.
--
-- Ce que la clôture a posé, et que l'annulation défait :
--   1. l'écriture d'écart de caisse (reference_type shift_close) : contre-passée
--      par une écriture miroir, même type, metadata.reverses = l'écriture
--      d'origine ; close_shift_v15 l'ignore à la clôture suivante ;
--   2. le règlement du tiroir (fond rendu à la petite caisse, reste en fonds non
--      déposés), posé à l'insertion du rapport Z : contre-passé de même, et la
--      ligne shift_cash_treasury redevient « non réglée » pour que la clôture
--      suivante règle à nouveau ;
--   3. le rapport Z brouillon : supprimé, son contenu entier gardé dans le
--      payload de la trace d'audit. Il est unique par session : la clôture
--      suivante en crée un neuf ;
--   4. la session : remise en open, champs de clôture et totaux figés effacés ;
--      leur valeur d'avant est dans le payload de la trace d'audit.
-- Le fond de caisse émis à l'ouverture n'est pas touché : la session rouverte
-- garde son fond.
-- Les contre-passations sont datées du jour de l'annulation.
-- Une session sans terminal (antérieure à S3-01) ne peut pas être dite la
-- dernière de son terminal : refusée.

-- Contre-passation d'une écriture : mêmes comptes, débit et crédit inversés.
-- L'index d'idempotence journal_entries_je_idempotency_uniq n'admet qu'une
-- écriture par (type, référence, metadata.movement_type). Pour que la clôture
-- suivante puisse poser à nouveau son écart et son règlement sur la même
-- session :
--   - la contre-passation porte movement_type = 'reversal:<id d'origine>' ;
--   - l'écriture d'origine reçoit movement_type = '<ancien>:reversed:<id>' et
--     reversed_by. Ses montants et ses lignes ne changent pas : seule son
--     étiquette technique change. Aucun lecteur ne filtre sur ces étiquettes
--     au 2026-11-19 (relevé des fonctions et du back-office).
CREATE FUNCTION public._reverse_shift_journal_entry_v1(
  p_je_id        uuid,
  p_description  text,
  p_actor        uuid,
  p_metadata     jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_orig  journal_entries%ROWTYPE;
  v_today date := CURRENT_DATE;
  v_new   uuid;
BEGIN
  SELECT * INTO v_orig FROM journal_entries WHERE id = p_je_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_entry_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE metadata->>'reverses' = p_je_id::text) THEN
    RAISE EXCEPTION 'journal_entry_already_reversed' USING ERRCODE = 'P0001';
  END IF;
  PERFORM check_fiscal_period_open(v_today);
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type,
                               reference_id, status, total_debit, total_credit,
                               created_by, metadata)
  VALUES (next_journal_entry_number(v_today), v_today, p_description,
          v_orig.reference_type, v_orig.reference_id, 'posted',
          v_orig.total_credit, v_orig.total_debit, p_actor,
          COALESCE(p_metadata, '{}'::jsonb)
            || jsonb_build_object('reverses', p_je_id, 'movement_type', 'reversal:' || p_je_id::text))
  RETURNING id INTO v_new;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_new, l.account_id, l.credit, l.debit, 'Reversal: ' || COALESCE(l.description, '')
    FROM journal_entry_lines l
   WHERE l.journal_entry_id = p_je_id;
  UPDATE journal_entries
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'movement_type', CASE WHEN metadata->>'movement_type' IS NULL
                                 THEN 'reversed:' || p_je_id::text
                                 ELSE (metadata->>'movement_type') || ':reversed:' || p_je_id::text END,
           'reversed_by', v_new)
   WHERE id = p_je_id;
  RETURN v_new;
END;
$function$;

REVOKE ALL ON FUNCTION public._reverse_shift_journal_entry_v1(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reverse_shift_journal_entry_v1(uuid, text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._reverse_shift_journal_entry_v1(uuid, text, uuid, jsonb) FROM authenticated;

CREATE FUNCTION public.undo_shift_close_v1(
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
  v_t         shift_cash_treasury%ROWTYPE;
  v_has_z     boolean;
  v_has_t     boolean;
  v_var_je    uuid;
  v_var_rev   uuid;
  v_set_rev   uuid;
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

  -- 2. Le règlement du tiroir.
  SELECT * INTO v_t FROM shift_cash_treasury WHERE session_id = v_s.id FOR UPDATE;
  v_has_t := FOUND;
  IF v_has_t AND v_t.settlement_je_id IS NOT NULL THEN
    v_set_rev := public._reverse_shift_journal_entry_v1(
      v_t.settlement_je_id, 'Shift cash settlement reversed (close undone)',
      v_profile, jsonb_build_object('kind', 'shift_cash_settlement_reversal',
                                    'session_id', v_s.id));
  END IF;
  IF v_has_t THEN
    UPDATE shift_cash_treasury
       SET settlement_je_id = NULL, settled_at = NULL,
           returned_float = NULL, safe_deposit = NULL
     WHERE session_id = v_s.id;
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
      'settlement_journal_entry', CASE WHEN v_has_t THEN v_t.settlement_je_id END,
      'settlement_reversal_entry', v_set_rev,
      'zreport_id',               CASE WHEN v_has_z THEN v_z.id END
    ),
    jsonb_build_object(
      'before',  to_jsonb(v_s),
      'zreport', CASE WHEN v_has_z THEN to_jsonb(v_z) END,
      'treasury', CASE WHEN v_has_t THEN to_jsonb(v_t) END
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

COMMENT ON FUNCTION public.undo_shift_close_v1(uuid, text, text) IS
  'S3-03 — le propriétaire annule la dernière clôture d''un terminal tant que son '
  'rapport Z est un brouillon. Refus : forbidden, pin_required, invalid_pin (retour), '
  'session_not_found, session_not_closed, terminal_unknown, session_not_last, '
  'user_session_open, zreport_not_draft.';

REVOKE ALL ON FUNCTION public.undo_shift_close_v1(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_shift_close_v1(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.undo_shift_close_v1(uuid, text, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
