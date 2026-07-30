-- supabase/tests/store_credit_reconciliation.test.sql
-- ADR-013 Lot 4 (D5) — invariant de réconciliation de l'avoir client :
--   SUM(customers.store_credit_balance) == SUM(ledger.delta) == mouvement du
--   compte 2220 (SUM credit - SUM debit des journal_entry_lines), sur un
--   scénario complet : grant (nonce PIN) -> conversion loyalty -> vente payée
--   en avoir (v21) -> refund émis en avoir (v8) -> void d'une vente payée en
--   avoir (v8, restitution).
--
-- NB trigger différé : fn_create_je_for_refund est CONSTRAINT DEFERRED — toutes
-- les opérations money-path sont jouées AVANT l'unique SET CONSTRAINTS ALL
-- IMMEDIATE, puis on assert (harness pattern reversal_je Lot 1).
-- Run via MCP execute_sql (BEGIN..ROLLBACK) ou API-from-file.

BEGIN;
SELECT plan(8);

-- Baseline du compte 2220 (le compte naît au Lot 4 : baseline attendue 0, mais
-- on assert en delta pour rester robuste).
DO $$
DECLARE v_base NUMERIC;
BEGIN
  SELECT COALESCE(SUM(credit) - SUM(debit), 0) INTO v_base
    FROM journal_entry_lines
   WHERE account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT');
  PERFORM set_config('scr.base2220', COALESCE(v_base, 0)::text, true);
END $$;

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_prod UUID; v_sess UUID;
  v_cust UUID; v_nonce UUID; v_res JSONB; v_order1 UUID; v_order2 UUID;
  v_oi UUID; v_qty NUMERIC;
BEGIN
  -- Un profil portant tout le trousseau (MANAGER/ADMIN) : vente + grant +
  -- conversion + autorisation refund/void.
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
     AND has_permission(up.auth_user_id, 'customers.store_credit.grant')
     AND has_permission(up.auth_user_id, 'customers.store_credit.convert')
     AND has_permission(up.auth_user_id, 'pos.sale.refund')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no manager-grade user found'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, track_inventory, is_display_item)
    VALUES ('TST-SC-RECON', 'SC Recon Product', v_cat, 20000, 1000, true, false)
    RETURNING id INTO v_prod;

  INSERT INTO customers (name, customer_type, loyalty_points, lifetime_points)
    VALUES ('SC Recon Customer', 'retail', 2000, 2000) RETURNING id INTO v_cust;

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  -- 1) GRANT 100 000 via nonce scope store_credit_grant.
  INSERT INTO discount_authorizations (manager_profile_id, scope)
    VALUES (v_prof, 'store_credit_grant') RETURNING id INTO v_nonce;
  v_res := grant_store_credit_v1(v_cust, 100000, 'reconciliation pgTAP grant', v_nonce, NULL);
  PERFORM set_config('scr.grant_bal', v_res->>'balance_after', true);

  -- 2) CONVERSION 1 000 pts -> +10 000.
  v_res := convert_loyalty_to_store_credit_v1(v_cust, 1000, NULL);

  -- 3) VENTE 1 payée intégralement en avoir (-20 000).
  v_res := complete_order_with_payment_v22(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','store_credit','amount',20000),
    p_customer_id := v_cust);
  v_order1 := (v_res->>'order_id')::uuid;

  -- 4) REFUND intégral de la vente 1, émis en avoir (+20 000).
  SELECT id, quantity INTO v_oi, v_qty FROM order_items WHERE order_id = v_order1 LIMIT 1;
  v_res := refund_order_rpc_v9(
    v_order1,
    jsonb_build_array(jsonb_build_object('order_item_id', v_oi, 'qty', v_qty)),
    jsonb_build_array(jsonb_build_object('method', 'store_credit', 'amount', 20000)),
    'reconciliation pgTAP refund-en-avoir',
    v_prof, NULL, v_auth);
  PERFORM set_config('scr.refund_bal', v_res->>'store_credit_balance_after', true);

  -- 5) VENTE 2 payée en avoir (-20 000) puis VOID (restitution +20 000).
  v_res := complete_order_with_payment_v22(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','store_credit','amount',20000),
    p_customer_id := v_cust);
  v_order2 := (v_res->>'order_id')::uuid;
  v_res := void_order_rpc_v9(v_order2, 'reconciliation pgTAP void', v_prof, v_auth, NULL);

  PERFORM set_config('scr.cust',   v_cust::text,   true);
  PERFORM set_config('scr.nonce',  v_nonce::text,  true);
  PERFORM set_config('scr.order1', v_order1::text, true);
  PERFORM set_config('scr.order2', v_order2::text, true);
END $$;

-- Flush unique du trigger refund différé, PUIS assertions.
SET CONSTRAINTS ALL IMMEDIATE;

-- T1 — grant : ledger +100 000, nonce consommé, JE DR 6117 / CR 2220.
SELECT ok(
  (SELECT count(*) FROM customer_store_credit_ledger
    WHERE customer_id = current_setting('scr.cust')::uuid
      AND source = 'manager_grant' AND delta = 100000) = 1
  AND (SELECT consumed_at IS NOT NULL FROM discount_authorizations
        WHERE id = current_setting('scr.nonce')::uuid)
  AND EXISTS (SELECT 1 FROM journal_entries je
               JOIN journal_entry_lines l ON l.journal_entry_id = je.id
              WHERE je.reference_type = 'store_credit_grant'
                AND l.account_id = resolve_mapping_account('STORE_CREDIT_GRANT_EXPENSE')
                AND l.debit = 100000),
  'T1: grant writes ledger row, consumes the nonce, JE DR 6117 / CR 2220');

-- T2 — vente 1 : spend -20 000 lié à la commande.
SELECT is(
  (SELECT count(*)::int FROM customer_store_credit_ledger
    WHERE customer_id = current_setting('scr.cust')::uuid AND source = 'spend'
      AND delta = -20000 AND reference_id = current_setting('scr.order1')::uuid),
  1, 'T2: sale 1 wrote one spend row (-20000)');

-- T3 — refund-en-avoir : +20 000 source refund + le JE sale_refund crédite 2220.
SELECT ok(
  (SELECT count(*) FROM customer_store_credit_ledger l
    JOIN refunds r ON r.id = l.reference_id
    WHERE l.customer_id = current_setting('scr.cust')::uuid
      AND l.source = 'refund' AND l.delta = 20000
      AND r.order_id = current_setting('scr.order1')::uuid AND r.is_full_void = false) = 1
  AND EXISTS (SELECT 1 FROM journal_entries je
               JOIN refunds r ON r.id = je.reference_id
               JOIN journal_entry_lines l ON l.journal_entry_id = je.id
              WHERE je.reference_type = 'sale_refund'
                AND r.order_id = current_setting('scr.order1')::uuid
                AND l.account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT')
                AND l.credit = 20000),
  'T3: refund-en-avoir credits the ledger AND the deferred JE credits 2220');

-- T4 — void : restitution +20 000 référencée sur le refund is_full_void.
SELECT ok(
  (SELECT count(*) FROM customer_store_credit_ledger l
    JOIN refunds r ON r.id = l.reference_id
    WHERE l.customer_id = current_setting('scr.cust')::uuid
      AND l.source = 'refund' AND l.delta = 20000
      AND r.order_id = current_setting('scr.order2')::uuid AND r.is_full_void = true) = 1
  AND EXISTS (SELECT 1 FROM journal_entries je
               JOIN journal_entry_lines l ON l.journal_entry_id = je.id
              WHERE je.reference_type = 'sale_void'
                AND je.reference_id = current_setting('scr.order2')::uuid
                AND l.account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT')
                AND l.credit = 20000),
  'T4: void restores the ledger (+20000) AND the sale_void JE credits 2220');

-- T5 — solde final : 100000 + 10000 - 20000 + 20000 - 20000 + 20000 = 110000.
SELECT is(
  (SELECT store_credit_balance FROM customers WHERE id = current_setting('scr.cust')::uuid),
  110000::numeric, 'T5: final cached balance is 110000');

-- T6 — invariant D5 (1) : cache == SUM(ledger.delta), et le balance_after de la
-- restitution du void (dernière opération du scénario) == cache. (Pas de tri
-- par created_at : identique pour toutes les lignes d'une même transaction.)
SELECT ok(
  (SELECT store_credit_balance FROM customers WHERE id = current_setting('scr.cust')::uuid)
    = (SELECT SUM(delta) FROM customer_store_credit_ledger
        WHERE customer_id = current_setting('scr.cust')::uuid)
  AND (SELECT l.balance_after FROM customer_store_credit_ledger l
        JOIN refunds r ON r.id = l.reference_id
        WHERE l.customer_id = current_setting('scr.cust')::uuid
          AND l.source = 'refund' AND r.is_full_void = true
          AND r.order_id = current_setting('scr.order2')::uuid)
    = (SELECT store_credit_balance FROM customers WHERE id = current_setting('scr.cust')::uuid),
  'T6: cached balance == SUM(ledger.delta) == balance_after of the void restore');

-- T7 — invariant D5 (2) : le mouvement du compte 2220 (delta vs baseline)
-- == SUM(ledger.delta) du scénario.
SELECT is(
  (SELECT COALESCE(SUM(credit) - SUM(debit), 0)
     FROM journal_entry_lines
    WHERE account_id = resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT'))
  - current_setting('scr.base2220')::numeric,
  (SELECT SUM(delta) FROM customer_store_credit_ledger
    WHERE customer_id = current_setting('scr.cust')::uuid),
  'T7: 2220 account movement == SUM(ledger.delta) (GL reconciliation)');

-- T8 — aucun JE déséquilibré introduit par le scénario.
SELECT is(
  (SELECT count(*)::int FROM journal_entries je
    WHERE je.total_debit <> je.total_credit
      AND je.reference_type IN ('store_credit_grant','store_credit_conversion',
                                'sale','sale_void','sale_refund')),
  0, 'T8: no unbalanced JE among the scenario entry types');

SELECT * FROM finish();
ROLLBACK;
