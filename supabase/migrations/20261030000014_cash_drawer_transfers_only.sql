-- Aucune charge depuis Cash Drawer : les dépenses restent à l'office, via Petty Cash.
CREATE OR REPLACE FUNCTION public.record_cash_movement_v4(p_session_id uuid, p_direction text, p_amount numeric, p_reason text, p_idempotency_key uuid DEFAULT NULL::uuid, p_reason_code text DEFAULT NULL::text, p_counterparty_account_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_status   TEXT;
  v_mvt_id   UUID;
  v_in_tot   NUMERIC(14,2);
  v_out_tot  NUMERIC(14,2);
  v_session_date DATE;
  v_je_id    UUID;
  v_entry_no TEXT;
  v_cash_id  UUID;
  v_capital_id UUID;
  v_bank_id  UUID;
  v_counterparty accounts%ROWTYPE;
  v_existing cash_movements%ROWTYPE;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'invalid_direction' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount <> round(p_amount,2) OR p_amount > 999999999999.99 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code NOT IN
    ('apport_owner', 'bank_transfer', 'replenishment', 'misc') THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'shift.cash_movement') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  SELECT * INTO v_existing FROM cash_movements WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.session_id<>p_session_id OR v_existing.direction<>p_direction
      OR v_existing.amount<>p_amount OR v_existing.reason<>p_reason
      OR v_existing.reason_code IS DISTINCT FROM p_reason_code
      OR v_existing.created_by IS DISTINCT FROM v_profile
      OR (v_existing.counterparty_account_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM accounts WHERE id=v_existing.counterparty_account_id AND code=p_counterparty_account_code)) THEN
      RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE='22023';
    END IF;
    SELECT cash_in_total,cash_out_total INTO v_in_tot,v_out_tot FROM pos_sessions WHERE id=p_session_id;
    SELECT id INTO v_je_id FROM journal_entries WHERE reference_type='cash_movement' AND reference_id=v_existing.id;
    RETURN jsonb_build_object('movement_id',v_existing.id,'session_id',p_session_id,
      'cash_in_total',v_in_tot,'cash_out_total',v_out_tot,'je_id',v_je_id,'idempotent_replay',true);
  END IF;
  IF p_reason_code IS NULL THEN RAISE EXCEPTION 'reason_code_required' USING ERRCODE='22023'; END IF;
  IF p_reason_code IN ('misc','replenishment') THEN
    SELECT * INTO v_counterparty FROM accounts WHERE code=p_counterparty_account_code
      AND is_active AND is_postable AND deleted_at IS NULL;
    IF NOT FOUND OR v_counterparty.id=resolve_mapping_account('SALE_PAYMENT_CASH') THEN
      RAISE EXCEPTION 'counterparty_account_required' USING ERRCODE='22023';
    END IF;
    IF v_counterparty.cash_flow_section<>'none' THEN
      RAISE EXCEPTION 'transfer_requires_cash_counterparty' USING ERRCODE='22023';
    END IF;
  ELSIF p_counterparty_account_code IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected_counterparty_account' USING ERRCODE='22023';
  END IF;
  IF p_reason_code='apport_owner' AND p_direction<>'in' THEN
    RAISE EXCEPTION 'owner_injection_must_be_cash_in' USING ERRCODE='22023';
  END IF;

  SELECT status INTO v_status FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status::text <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO cash_movements (session_id, direction, amount, reason, reason_code, idempotency_key, created_by, counterparty_account_id)
  VALUES (p_session_id, p_direction, p_amount, p_reason, p_reason_code, p_idempotency_key, v_profile, v_counterparty.id)
  RETURNING id INTO v_mvt_id;

  IF p_direction = 'in' THEN
    UPDATE pos_sessions SET cash_in_total = cash_in_total + p_amount WHERE id = p_session_id;
  ELSE
    UPDATE pos_sessions SET cash_out_total = cash_out_total + p_amount WHERE id = p_session_id;
  END IF;

  IF p_reason_code IS NOT NULL THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);
    v_session_date := CURRENT_DATE;
    v_entry_no := next_journal_entry_number(v_session_date);

    v_cash_id    := resolve_mapping_account('SALE_PAYMENT_CASH');
    v_capital_id := resolve_mapping_account('CASH_MOVEMENT_OWNER_CAPITAL');
    v_bank_id    := resolve_mapping_account('CASH_MOVEMENT_BANK');

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, v_session_date,
      'Cash movement: ' || p_reason_code || ' (' || p_direction || ' ' || p_amount::TEXT || ') — ' || p_reason,
      'cash_movement', v_mvt_id,
      'posted', p_amount, p_amount, v_profile
    ) RETURNING id INTO v_je_id;

    IF p_reason_code = 'apport_owner' THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_cash_id,    p_amount, 0,        'Cash injection by owner'),
        (v_je_id, v_capital_id, 0,        p_amount, 'Owner capital contribution');
    ELSIF p_reason_code IN ('misc','replenishment') THEN
      IF p_direction='in' THEN
        INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description) VALUES
          (v_je_id,v_cash_id,p_amount,0,p_reason),(v_je_id,v_counterparty.id,0,p_amount,p_reason);
      ELSE
        INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description) VALUES
          (v_je_id,v_counterparty.id,p_amount,0,p_reason),(v_je_id,v_cash_id,0,p_amount,p_reason);
      END IF;
    ELSIF p_reason_code = 'bank_transfer' THEN
      IF p_direction = 'in' THEN
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_cash_id, p_amount, 0,        'Cash refill from bank'),
          (v_je_id, v_bank_id, 0,        p_amount, 'Bank withdrawal for cash float');
      ELSE
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_bank_id, p_amount, 0,        'Bank deposit from cash'),
          (v_je_id, v_cash_id, 0,        p_amount, 'Cash deposited to bank');
      END IF;
    END IF;
  END IF;

  SELECT cash_in_total, cash_out_total INTO v_in_tot, v_out_tot
    FROM pos_sessions WHERE id = p_session_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'shift.cash_movement', 'cash_movements', v_mvt_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'direction', p_direction,
      'amount', p_amount,
      'reason', p_reason,
      'reason_code', p_reason_code,
      'je_id', v_je_id,
      'counterparty_account_id', v_counterparty.id,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'movement_id', v_mvt_id,
    'session_id', p_session_id,
    'cash_in_total', v_in_tot,
    'cash_out_total', v_out_tot,
    'je_id', v_je_id,
    'idempotent_replay', FALSE
  );
END $function$
;
CREATE OR REPLACE FUNCTION public.get_cash_movement_counterparties_v2()
 RETURNS TABLE(code text, name text, is_cash boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'shift.cash_movement') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT a.code,a.name,a.cash_flow_section='none' FROM accounts a
    WHERE a.is_active AND a.is_postable AND a.deleted_at IS NULL
      AND a.id<>resolve_mapping_account('SALE_PAYMENT_CASH')
      AND a.cash_flow_section='none'
    ORDER BY a.code;
END $function$
;
DROP FUNCTION public.record_cash_movement_v3(uuid,text,numeric,text,uuid,text,text);
DROP FUNCTION public.get_cash_movement_counterparties_v1();
REVOKE ALL ON FUNCTION public.record_cash_movement_v4(uuid,text,numeric,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_movement_v4(uuid,text,numeric,text,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_cash_movement_counterparties_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_movement_counterparties_v2() TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
