-- 20260901000006_record_b2b_payment_v3_refuse_remainder.sql
--
-- Audit lot 1 du 2026-08-31, P0 n°4 (docs/audits/2026-08-31-audit-b2b-credit.md,
-- finding 1) — lot B du plan validé le 2026-09-05.
--
-- `record_b2b_payment_v2` décrémentait `customers.b2b_current_balance` du montant
-- PLEIN et postait la JE Dr Cash / Cr B2B_AR au montant PLEIN avant toute
-- allocation, puis la boucle ciblée et la boucle FIFO s'arrêtaient quand plus
-- aucune facture n'était à servir — et `v_remaining` était jeté sans exception,
-- sans trace, sans ligne de ledger. Prouvé en live sous transaction annulée :
-- 300 000 encaissés, 100 000 alloués, 200 000 évaporés, solde à 0 comme si tout
-- s'était bien passé. Deux chemins normaux y mènent : un solde gonflé par
-- `adjust_b2b_balance` (aucune facture en face), et une facture dans un statut
-- que la boucle FIFO ne scannait pas (`b2b_pending` seul, alors que la boucle
-- ciblée acceptait tout statut sauf `voided`). Aucune contrainte n'impose
-- Σ b2b_payment_allocations.amount_applied = b2b_payments.amount.
--
-- Décisions de Mamat (2026-09-05) :
--   1. REFUSER plutôt que perdre : si `v_remaining > 0` après les deux boucles,
--      la RPC lève `payment_not_fully_allocated` (P0011). Le RAISE annule d'un
--      bloc la JE, la ligne de paiement, les allocations et le décrément du
--      cache — atomique par construction, aucune écriture partielle.
--      L'acompte non affecté (avance client) est un changement d'architecture AR,
--      hors de ce lot.
--   2. FIFO alignée sur la boucle ciblée : `o.status <> 'voided'` + outstanding > 0.
--      Sur la machine à états live c'est un no-op (b2b_pending → paid au règlement
--      complet, voided à l'annulation), mais cela ferme le seul chemin où le
--      nouveau refus se déclencherait alors que de l'argent est réellement dû.
--   3. Payload enrichi de `allocated_total` et `unallocated` (0 en succès ; sur
--      replay idempotent, recalculés depuis le ledger — un paiement historique
--      amputé par la v2 dit alors la vérité). Audit `rpc_version` = 'v3'.
--
-- La contrainte Σ allocations = montant (trigger de contrainte différé) est un
-- lot séparé : elle exige d'abord une réconciliation des paiements historiques
-- amputés par la v2.
--
-- Versioning monotone : v3 créée, v2 droppée dans cette migration, signature
-- inchangée. Un seul appelant : `useRecordB2bPayment` (back-office).
--
-- PROVENANCE DU CORPS : `pg_get_functiondef` sur la base live, relevé le
-- 2026-09-05. Le garde ci-dessous refuse la migration si le corps a dérivé
-- depuis — retransformer depuis le live, ne jamais forcer.
--
-- Grants : miroir exact des grants live (authenticated + service_role) +
-- REVOKE PUBLIC/anon. Types à régénérer (packages/supabase/src/types.generated.ts).

DO $$
DECLARE v_md5 TEXT;
BEGIN
  SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_b2b_payment_v2';
  IF v_md5 IS DISTINCT FROM 'cb192b42adc0f89bcddc2d490d3f9712' THEN
    RAISE EXCEPTION 'corps live de record_b2b_payment_v2 inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-05, retransformer depuis pg_get_functiondef', v_md5;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_b2b_payment_v3(p_customer_id uuid, p_amount numeric, p_method payment_method, p_reference text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_invoice_ids uuid[] DEFAULT NULL::uuid[])
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
    SELECT * INTO v_existing_row
      FROM b2b_payments WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
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

  SELECT b2b_current_balance INTO v_balance_before
    FROM customers WHERE id = p_customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before, 0);
  IF v_balance_before - p_amount < 0 THEN
    RAISE EXCEPTION 'overpayment_not_allowed (balance: %, amount: %)',
      v_balance_before, p_amount USING ERRCODE = 'P0011';
  END IF;
  v_balance_after := v_balance_before - p_amount;

  v_cash_or_bank_id := CASE
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

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.payment.recorded', 'b2b_payments', v_payment_id,
    jsonb_build_object(
      'amount', p_amount, 'method', p_method::text, 'customer_id', p_customer_id,
      'balance_before', v_balance_before, 'balance_after', v_balance_after,
      'allocation', v_alloc_json, 'je_id', v_je_id, 'payment_number', v_payment_number,
      'rpc_version', 'v3'
    )
  );

  RETURN jsonb_build_object(
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
END $function$;

REVOKE ALL ON FUNCTION public.record_b2b_payment_v3(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_b2b_payment_v3(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_b2b_payment_v3(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_b2b_payment_v3(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.record_b2b_payment_v3(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]) IS
  'S52 P1.2 — B2B payment with real per-invoice allocation (b2b_payment_allocations). Targeted via p_invoice_ids (array order) then FIFO remainder over every non-voided invoice with an outstanding; sets orders.paid_at + status=paid on full settlement. v3 (2026-09-05, audit lot 1 P0 n°4): a remainder no invoice can absorb is REFUSED (P0011 payment_not_fully_allocated) instead of being silently dropped; payload carries allocated_total and unallocated. Gate b2b.payment.record. Idempotent via p_idempotency_key. Errors: P0001/P0002/P0003/P0004/P0011.';

-- Versioning monotone : la v2 tombe dans la même migration.
DROP FUNCTION IF EXISTS public.record_b2b_payment_v2(uuid, numeric, payment_method, text, timestamptz, text, uuid, uuid[]);

-- Défense en profondeur : anon hérite EXECUTE via PUBLIC sur toute fonction future.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
