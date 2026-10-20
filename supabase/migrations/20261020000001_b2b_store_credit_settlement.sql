-- Paiement B2B par avoir : ledger/solde et Dr2220/Cr1132 atomiques.
-- Corps de départ : pg_get_functiondef dev, 2026-10-20 15:01:01.271989+08.
-- Rejeu conservé dans audit_logs.metadata ; aucun nouvel objet métier.

DO $check$
BEGIN
  IF md5(pg_get_functiondef('public.record_b2b_payment_v3(uuid,numeric,payment_method,text,timestamptz,text,uuid,uuid[])'::regprocedure))
     <> 'acd44638773bda7d17a70eee54af3194' THEN
    RAISE EXCEPTION 'record_b2b_payment source drift: inspect live definition before applying';
  END IF;
END $check$;

CREATE OR REPLACE FUNCTION public.record_b2b_payment_v4(p_customer_id uuid, p_amount numeric, p_method payment_method, p_reference text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_invoice_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile_id       UUID;
  v_customer_type    customer_type;
  v_balance_before   NUMERIC(14,2);
  v_balance_after    NUMERIC(14,2);
  v_existing_row     b2b_payments%ROWTYPE;
  v_existing_alloc   NUMERIC(14,2);
  v_result           JSONB;
  v_sc_before        NUMERIC(14,2);
  v_sc_after         NUMERIC(14,2);
  v_sc_ledger_id     UUID;
  v_payment_id       UUID;
  v_payment_number   TEXT;
  v_je_id            UUID;
  v_entry_no         TEXT;
  v_cash_or_bank_id  UUID;
  v_ar_id            UUID;
  v_remaining        NUMERIC(14,2);
  v_apply            NUMERIC(14,2);
  v_alloc_json       JSONB := '[]'::jsonb;
  v_target_id        UUID;
  v_fully            BOOLEAN;
  v_inv              RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile_id
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'b2b.payment.record') THEN
    RAISE EXCEPTION 'permission_denied: b2b.payment.record' USING ERRCODE = 'P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    -- Sérialiser avant toute lecture : un retry concurrent attend le premier résultat.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'b2b-payment:' || p_idempotency_key::text, 0));
    SELECT * INTO v_existing_row
      FROM b2b_payments WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      SELECT metadata->'result' INTO v_result FROM audit_logs
       WHERE action = 'b2b.payment.recorded' AND entity_id = v_existing_row.id
       LIMIT 1;
      IF v_result IS NOT NULL THEN
        RETURN v_result || jsonb_build_object('idempotent_replay', TRUE);
      END IF;
      -- Compatibilité : les paiements historiques n'ont pas d'enveloppe conservée.
      SELECT b2b_current_balance INTO v_balance_after
        FROM customers WHERE id = v_existing_row.customer_id;
      -- Replay : les deux totaux se relisent dans le ledger d'allocations, pas
      -- dans le snapshot JSONB — un paiement historique amputé par la v2 rend
      -- ici un `unallocated` > 0, c'est la vérité du ledger.
      SELECT COALESCE(SUM(a.amount_applied), 0) INTO v_existing_alloc
        FROM b2b_payment_allocations a WHERE a.payment_id = v_existing_row.id;
      RETURN jsonb_build_object(
        'payment_id',             v_existing_row.id,
        'payment_number',         v_existing_row.payment_number,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('invoice_id', a.invoice_id, 'amount_applied', a.amount_applied))
            FROM b2b_payment_allocations a WHERE a.payment_id = v_existing_row.id), '[]'::jsonb),
        'allocation',             v_existing_row.allocation,
        'allocated_total',        v_existing_alloc,
        'unallocated',            v_existing_row.amount - v_existing_alloc,
        'je_id',                  v_existing_row.journal_entry_id,
        'customer_balance_after', COALESCE(v_balance_after, 0),
        'idempotent_replay',      TRUE
      );
    END IF;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = 'P0001';
  END IF;

  SELECT customer_type INTO v_customer_type
    FROM customers WHERE id = p_customer_id AND deleted_at IS NULL LIMIT 1;
  IF v_customer_type IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_type <> 'b2b' THEN
    RAISE EXCEPTION 'customer_not_b2b' USING ERRCODE = 'P0001';
  END IF;

  PERFORM check_fiscal_period_open(p_paid_at::date);

  SELECT b2b_current_balance, store_credit_balance INTO v_balance_before, v_sc_before
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before, 0);
  IF v_balance_before - p_amount < 0 THEN
    RAISE EXCEPTION 'overpayment_not_allowed (balance: %, amount: %)',
      v_balance_before, p_amount USING ERRCODE = 'P0011';
  END IF;
  v_balance_after := v_balance_before - p_amount;

  IF p_method = 'store_credit' AND COALESCE(v_sc_before, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient store credit balance (available: %, requested: %)',
      COALESCE(v_sc_before, 0), p_amount USING ERRCODE = 'P0016';
  END IF;

  v_cash_or_bank_id := CASE
    WHEN p_method = 'store_credit' THEN resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT')
    WHEN p_method = 'cash' THEN resolve_mapping_account('SALE_PAYMENT_CASH')
    ELSE resolve_mapping_account('B2B_PAYMENT_BANK')
  END;
  v_ar_id    := resolve_mapping_account('B2B_AR');
  v_entry_no := next_journal_entry_number(p_paid_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_paid_at::date,
    'B2B payment received from customer ' || p_customer_id::text,
    'b2b_payment', NULL, 'posted', p_amount, p_amount, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_cash_or_bank_id, p_amount, 0, 'B2B payment received (' || p_method::text || ')'),
    (v_je_id, v_ar_id,           0, p_amount, 'B2B AR settlement');

  v_payment_number := 'BP-' || to_char(p_paid_at, 'YYYY') || '-' ||
                      LPAD(nextval('b2b_payment_seq')::text, 4, '0');

  INSERT INTO b2b_payments (
    payment_number, customer_id, amount, method, reference, paid_at,
    created_by, idempotency_key, allocation, journal_entry_id, notes
  ) VALUES (
    v_payment_number, p_customer_id, p_amount, p_method, p_reference, p_paid_at,
    v_profile_id, p_idempotency_key, '[]'::jsonb, v_je_id, p_notes
  ) RETURNING id INTO v_payment_id;

  UPDATE journal_entries SET reference_id = v_payment_id WHERE id = v_je_id;

  IF p_method = 'store_credit' THEN
    -- Le verrou client est déjà acquis. La primitive écrit solde + ledger,
    -- sans émettre de JE : celle du règlement porte Dr2220 / Cr1132.
    SELECT a.ledger_id, a.balance_after INTO v_sc_ledger_id, v_sc_after
      FROM _apply_store_credit_v1(
        p_customer_id, -p_amount, 'spend', 'b2b_payments', v_payment_id,
        NULL, v_profile_id, p_idempotency_key) a;
  END IF;

  UPDATE customers SET b2b_current_balance = v_balance_after, updated_at = now()
   WHERE id = p_customer_id;

  v_remaining := p_amount;

  IF p_invoice_ids IS NOT NULL THEN
    FOREACH v_target_id IN ARRAY p_invoice_ids LOOP
      EXIT WHEN v_remaining <= 0;
      SELECT o.id,
             o.total - COALESCE((SELECT SUM(a.amount_applied)
                                   FROM b2b_payment_allocations a WHERE a.invoice_id = o.id), 0) AS outstanding
        INTO v_inv
        FROM orders o
       WHERE o.id = v_target_id
         AND o.customer_id = p_customer_id
         AND o.order_type = 'b2b'
         AND o.status <> 'voided'
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_target_invoice: %', v_target_id USING ERRCODE = 'P0001';
      END IF;
      IF v_inv.outstanding <= 0 THEN
        RAISE EXCEPTION 'target_invoice_already_settled: %', v_target_id USING ERRCODE = 'P0001';
      END IF;
      v_apply := LEAST(v_inv.outstanding, v_remaining);
      INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
        VALUES (v_payment_id, v_target_id, v_apply);
      IF v_apply >= v_inv.outstanding THEN
        UPDATE orders SET paid_at = p_paid_at, status = 'paid' WHERE id = v_target_id;
        v_fully := TRUE;
      ELSE
        v_fully := FALSE;
      END IF;
      v_alloc_json := v_alloc_json || jsonb_build_object(
        'invoice_id', v_target_id, 'amount_applied', v_apply, 'fully_settled', v_fully);
      v_remaining := v_remaining - v_apply;
    END LOOP;
  END IF;

  -- FIFO sur le reliquat : même prédicat de statut que la boucle ciblée
  -- (`<> 'voided'`), le garde `outstanding <= 0` écarte les factures soldées.
  FOR v_inv IN
    SELECT o.id,
           o.total - COALESCE((SELECT SUM(a.amount_applied)
                                 FROM b2b_payment_allocations a WHERE a.invoice_id = o.id), 0) AS outstanding
      FROM orders o
     WHERE o.customer_id = p_customer_id
       AND o.order_type  = 'b2b'
       AND o.status      <> 'voided'
     ORDER BY o.created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN v_inv.outstanding <= 0;
    CONTINUE WHEN EXISTS (SELECT 1 FROM b2b_payment_allocations a
                           WHERE a.payment_id = v_payment_id AND a.invoice_id = v_inv.id);
    v_apply := LEAST(v_inv.outstanding, v_remaining);
    INSERT INTO b2b_payment_allocations (payment_id, invoice_id, amount_applied)
      VALUES (v_payment_id, v_inv.id, v_apply);
    IF v_apply >= v_inv.outstanding THEN
      UPDATE orders SET paid_at = p_paid_at, status = 'paid' WHERE id = v_inv.id;
      v_fully := TRUE;
    ELSE
      v_fully := FALSE;
    END IF;
    v_alloc_json := v_alloc_json || jsonb_build_object(
      'invoice_id', v_inv.id, 'amount_applied', v_apply, 'fully_settled', v_fully);
    v_remaining := v_remaining - v_apply;
  END LOOP;

  -- Refuser plutôt que perdre : un reliquat que plus aucune facture ne peut
  -- absorber annule tout (JE, paiement, allocations, cache) — la v2 le jetait.
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'payment_not_fully_allocated (unallocated: %, amount: %)',
      v_remaining, p_amount
      USING ERRCODE = 'P0011',
            DETAIL  = jsonb_build_object(
              'unallocated',     v_remaining,
              'allocated_total', p_amount - v_remaining,
              'allocations',     v_alloc_json
            )::text;
  END IF;

  UPDATE b2b_payments SET allocation = v_alloc_json WHERE id = v_payment_id;

  v_result := jsonb_build_object(
    'payment_id',             v_payment_id,
    'payment_number',         v_payment_number,
    'allocations',            v_alloc_json,
    'allocation',             v_alloc_json,
    'allocated_total',        p_amount - v_remaining,
    'unallocated',            v_remaining,
    'je_id',                  v_je_id,
    'customer_balance_after', v_balance_after,
    'idempotent_replay',      FALSE
  );

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.payment.recorded', 'b2b_payments', v_payment_id,
    jsonb_build_object(
      'amount', p_amount, 'method', p_method::text, 'customer_id', p_customer_id,
      'balance_before', v_balance_before, 'balance_after', v_balance_after,
      'allocation', v_alloc_json, 'je_id', v_je_id, 'payment_number', v_payment_number,
      'rpc_version', 'v4', 'store_credit_ledger_id', v_sc_ledger_id,
      'store_credit_balance_before', CASE WHEN p_method = 'store_credit' THEN v_sc_before END,
      'store_credit_balance_after', v_sc_after, 'result', v_result
    )
  );

  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  -- Défense complémentaire : aucun débit/JE de cette tentative ne survit au
  -- rollback du bloc. Ne masquer que le conflit de SA clé métier.
  IF p_idempotency_key IS NULL THEN RAISE; END IF;
  SELECT a.metadata->'result' INTO v_result
    FROM b2b_payments p JOIN audit_logs a
      ON a.entity_id = p.id AND a.action = 'b2b.payment.recorded'
   WHERE p.idempotency_key = p_idempotency_key
   LIMIT 1;
  IF v_result IS NULL THEN RAISE; END IF;
  RETURN v_result || jsonb_build_object('idempotent_replay', TRUE);
END $function$;

REVOKE ALL ON FUNCTION public.record_b2b_payment_v4(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_b2b_payment_v4(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.record_b2b_payment_v4(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) IS
  'B2B settlement: targeted/FIFO allocation, atomic store-credit spend with Dr2220/Cr1132, original-result replay; permission b2b.payment.record.';
DROP FUNCTION public.record_b2b_payment_v3(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]);
