-- supabase/tests/reversal_je_single_and_method_mapping.test.sql
-- ADR-013 Lot 1 — fn_create_je_for_refund : D2 (void = 0 JE sale_refund) + D3a
-- (mapping par tender aligné sur l'enum réel ET effectif via trigger déféré).
--
-- Le trigger trg_create_je_for_refund est CONSTRAINT TRIGGER DEFERRABLE INITIALLY
-- DEFERRED : il tire au COMMIT, quand refund_payments est peuplé (comme le fait
-- refund_order_rpc : insert refund -> insert tenders -> commit).
--
-- IMPORTANT test harness : SET CONSTRAINTS ALL IMMEDIATE bascule le mode en
-- immediate pour TOUT le reste de la transaction. On insère donc TOUS les refunds
-- + leurs tenders d'abord (triggers en attente, différés), PUIS un seul flush,
-- PUIS on assert. (Un flush par refund ferait tirer les suivants à l'INSERT,
-- tenders absents -> fallback cash faussé.)
--
-- Run via MCP execute_sql sous BEGIN..ROLLBACK. Fixtures en insert direct.

BEGIN;
SELECT plan(8);

DO $$
DECLARE
  v_p UUID; v_s UUID; v_o UUID;
  r_card UUID; r_tr UUID; r_qr UUID; r_sc UUID; r_void UUID; r_bal UUID; r_noten UUID;
  v_je UUID; v_n INT; v_fb INT; v_dr NUMERIC; v_cr NUMERIC; v_cnt INT; v_nje INT;
BEGIN
  SELECT id INTO v_p FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_s FROM pos_sessions WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
  IF v_s IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_p, 0, 'open') RETURNING id INTO v_s;
  END IF;
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#RJE-ORD', v_s, v_p, 'take_out', 'draft', 22000, 2000, 22000, 'pos') RETURNING id INTO v_o;

  -- ── Insertion de tous les refunds + tenders (triggers différés, en attente) ──
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-CARD', v_o, v_s, 11000, 1000, 'card', v_p, v_p, false) RETURNING id INTO r_card;
  INSERT INTO refund_payments (refund_id, method, amount) VALUES (r_card, 'card', 11000);

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-TR', v_o, v_s, 5500, 500, 'transfer', v_p, v_p, false) RETURNING id INTO r_tr;
  INSERT INTO refund_payments (refund_id, method, amount) VALUES (r_tr, 'transfer', 5500);

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-QR', v_o, v_s, 3300, 300, 'qris', v_p, v_p, false) RETURNING id INTO r_qr;
  INSERT INTO refund_payments (refund_id, method, amount) VALUES (r_qr, 'qris', 3300);

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-SC', v_o, v_s, 2200, 200, 'store_credit', v_p, v_p, false) RETURNING id INTO r_sc;
  INSERT INTO refund_payments (refund_id, method, amount) VALUES (r_sc, 'store_credit', 2200);

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-VOID', v_o, v_s, 11000, 1000, 'full void', v_p, v_p, true) RETURNING id INTO r_void;
  INSERT INTO refund_payments (refund_id, method, amount) VALUES (r_void, 'card', 11000);

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-BAL', v_o, v_s, 11000, 1000, 'balance', v_p, v_p, false) RETURNING id INTO r_bal;
  INSERT INTO refund_payments (refund_id, method, amount) VALUES (r_bal, 'card', 11000);

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES ('RJE-NOTEN', v_o, v_s, 4400, 400, 'no tender', v_p, v_p, false) RETURNING id INTO r_noten;
  -- pas de tender pour r_noten (teste le fallback)

  -- ── Un seul flush : tous les triggers différés tirent, tenders présents ──
  SET CONSTRAINTS ALL IMMEDIATE;

  -- T1 : card -> 1116, zéro fallback
  SELECT id INTO v_je FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_card;
  SELECT count(*) INTO v_n  FROM journal_entry_lines WHERE journal_entry_id=v_je AND account_id=resolve_mapping_account('SALE_PAYMENT_DEBIT') AND credit=11000;
  SELECT count(*) INTO v_fb FROM journal_entry_lines WHERE journal_entry_id=v_je AND description ILIKE '%fallback%';
  PERFORM set_config('rje.t1', (v_n=1 AND v_fb=0)::text, true);

  -- T2 : transfer -> 1112
  SELECT id INTO v_je FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_tr;
  SELECT count(*) INTO v_n FROM journal_entry_lines WHERE journal_entry_id=v_je AND account_id=resolve_mapping_account('SALE_PAYMENT_TRANSFER') AND credit=5500;
  PERFORM set_config('rje.t2', (v_n=1)::text, true);

  -- T3 : qris -> 1115
  SELECT id INTO v_je FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_qr;
  SELECT count(*) INTO v_n FROM journal_entry_lines WHERE journal_entry_id=v_je AND account_id=resolve_mapping_account('SALE_PAYMENT_QRIS') AND credit=3300;
  PERFORM set_config('rje.t3', (v_n=1)::text, true);

  -- T4 : store_credit -> 2220 Customer Store Credit Payable (ADR-013 Lot 4, D4/D3b)
  SELECT id INTO v_je FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_sc;
  SELECT count(*) INTO v_n FROM journal_entry_lines WHERE journal_entry_id=v_je AND account_id=resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT') AND credit=2200;
  PERFORM set_config('rje.t4', (v_n=1)::text, true);

  -- T5 : is_full_void -> 0 JE (D2)
  SELECT count(*) INTO v_cnt FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_void;
  PERFORM set_config('rje.t5', (v_cnt=0)::text, true);

  -- T6 : un seul JE + équilibre debit=credit=total
  SELECT count(*) INTO v_nje FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_bal;
  SELECT COALESCE(SUM(jel.debit),0), COALESCE(SUM(jel.credit),0) INTO v_dr, v_cr
    FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id
    WHERE je.reference_type='sale_refund' AND je.reference_id=r_bal;
  PERFORM set_config('rje.t6', (v_nje=1 AND v_dr=11000 AND v_cr=11000)::text, true);

  -- T7 : sans tender -> fallback cash (1110)
  SELECT id INTO v_je FROM journal_entries WHERE reference_type='sale_refund' AND reference_id=r_noten;
  SELECT count(*) INTO v_n FROM journal_entry_lines WHERE journal_entry_id=v_je AND account_id=resolve_mapping_account('SALE_PAYMENT_CASH') AND credit=4400 AND description ILIKE '%fallback%';
  PERFORM set_config('rje.t7', (v_n=1)::text, true);
END $$;

SELECT ok(current_setting('rje.t1')::boolean, 'T1 refund card credite Card Clearing (1116), pas de fallback');
SELECT ok(current_setting('rje.t2')::boolean, 'T2 refund transfer credite Bank Operating (1112)');
SELECT ok(current_setting('rje.t3')::boolean, 'T3 refund qris credite QRIS Clearing (1115)');
SELECT ok(current_setting('rje.t4')::boolean, 'T4 refund store_credit credite 2220 Customer Store Credit Payable (Lot 4)');
SELECT ok(current_setting('rje.t5')::boolean, 'T5 refund is_full_void ne cree AUCUN JE sale_refund (D2)');
SELECT ok(current_setting('rje.t6')::boolean, 'T6 un seul JE sale_refund, equilibre debit=credit=total');
SELECT ok(current_setting('rje.t7')::boolean, 'T7 refund sans tender -> fallback cash (1110) present');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_create_je_for_refund' AND tgconstraint <> 0 AND tgdeferrable),
  'T8 trg_create_je_for_refund est un constraint trigger deferrable'
);

SELECT * FROM finish();
ROLLBACK;
