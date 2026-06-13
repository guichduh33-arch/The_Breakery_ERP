-- supabase/tests/s44_je_by_method.test.sql
-- S44 Wave A (P0-A b + D2) — create_sale_journal_entry split la JE par méthode RÉELLE.
-- Le trigger calcule la JE depuis NEW.total (pas les items) → pas besoin de products/items.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK). GUC pass-flag pattern S25 (DEV-S25-2.A-03).
BEGIN;
SELECT plan(7);

-- Fixture : un served_by (profile) + une session POS open (orders.session_id NOT NULL pour pos).
DO $$
DECLARE v_prof UUID; v_sess UUID;
BEGIN
  SELECT id INTO v_prof FROM user_profiles WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;
  PERFORM set_config('s44.profile_id', v_prof::text, true);
  PERFORM set_config('s44.session_id', v_sess::text, true);
END $$;

-- T1 : ordre pending_payment → 1 payment qris → UPDATE paid ⇒ ligne débit sur le compte QRIS, zéro fallback.
DO $$
DECLARE v_order_id UUID; v_acc UUID; v_n INT; v_fb INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T1JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 35000, 3182, 35000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'qris', 35000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;

  v_acc := resolve_mapping_account('SALE_PAYMENT_QRIS');
  SELECT count(*) INTO v_n FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.account_id = v_acc AND jel.debit = 35000;
  SELECT count(*) INTO v_fb FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.description ILIKE '%fallback to cash%';
  PERFORM set_config('s44.t1_pass', (v_n = 1 AND v_fb = 0)::text, true);
END $$;
SELECT ok(current_setting('s44.t1_pass')::boolean, 'T1 QRIS sale debits the QRIS account, no cash fallback');

-- T2 : method 'card' ⇒ compte SALE_PAYMENT_DEBIT.
DO $$
DECLARE v_order_id UUID; v_acc UUID; v_n INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T2JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 20000, 1818, 20000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'card', 20000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;
  v_acc := resolve_mapping_account('SALE_PAYMENT_DEBIT');
  SELECT count(*) INTO v_n FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.account_id = v_acc AND jel.debit = 20000;
  PERFORM set_config('s44.t2_pass', (v_n = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t2_pass')::boolean, 'T2 card sale debits the DEBIT account');

-- T3 : method 'edc' ⇒ compte SALE_PAYMENT_DEBIT.
DO $$
DECLARE v_order_id UUID; v_acc UUID; v_n INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T3JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 25000, 2273, 25000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'edc', 25000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;
  v_acc := resolve_mapping_account('SALE_PAYMENT_DEBIT');
  SELECT count(*) INTO v_n FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.account_id = v_acc AND jel.debit = 25000;
  PERFORM set_config('s44.t3_pass', (v_n = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t3_pass')::boolean, 'T3 edc sale debits the DEBIT account');

-- T4 : method 'transfer' ⇒ compte SALE_PAYMENT_TRANSFER (1112).
DO $$
DECLARE v_order_id UUID; v_acc UUID; v_n INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T4JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 50000, 4545, 50000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'transfer', 50000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;
  v_acc := resolve_mapping_account('SALE_PAYMENT_TRANSFER');
  SELECT count(*) INTO v_n FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.account_id = v_acc AND jel.debit = 50000;
  PERFORM set_config('s44.t4_pass', (v_n = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t4_pass')::boolean, 'T4 transfer sale debits the TRANSFER account (1112)');

-- T5 : split cash 20000 + qris 15000 ⇒ 2 lignes débit, somme débits paiement = total, JE équilibrée.
DO $$
DECLARE v_order_id UUID; v_cash UUID; v_qris UUID; v_sum NUMERIC; v_bal NUMERIC;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T5JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 35000, 3182, 35000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'cash', 20000), (v_order_id, 'qris', 15000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;
  v_cash := resolve_mapping_account('SALE_PAYMENT_CASH');
  v_qris := resolve_mapping_account('SALE_PAYMENT_QRIS');
  SELECT COALESCE(SUM(jel.debit),0) INTO v_sum FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.account_id IN (v_cash, v_qris);
  SELECT COALESCE(SUM(jel.debit),0) - COALESCE(SUM(jel.credit),0) INTO v_bal FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id;
  PERFORM set_config('s44.t5_pass', (v_sum = 35000 AND abs(v_bal) < 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t5_pass')::boolean, 'T5 split cash+qris: payment debits sum to total, JE balanced');

-- T6 : ordre paid SANS payments (legacy/B2B) ⇒ fallback cash PRÉSENT + 1 audit_logs je.payment_fallback_cash.
DO $$
DECLARE v_order_id UUID; v_fb INT; v_au INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T6JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'paid', 12000, 1091, 12000, 'pos')
    RETURNING id INTO v_order_id;
  SELECT count(*) INTO v_fb FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale' AND je.reference_id=v_order_id
      AND jel.description ILIKE '%fallback to cash%';
  SELECT count(*) INTO v_au FROM audit_logs
    WHERE action='je.payment_fallback_cash' AND entity_id=v_order_id AND metadata->>'direction'='sale';
  PERFORM set_config('s44.t6_pass', (v_fb = 1 AND v_au = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t6_pass')::boolean, 'T6 paid-without-payments: cash fallback line + audit row present');

-- T7 : non-régression void — UPDATE paid→voided ⇒ JE 'sale_void' split par méthode (qris crédit).
DO $$
DECLARE v_order_id UUID; v_qris UUID; v_n INT;
BEGIN
  INSERT INTO orders (order_number, session_id, served_by, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T7JE', current_setting('s44.session_id')::uuid, current_setting('s44.profile_id')::uuid,
            'take_out', 'pending_payment', 30000, 2727, 30000, 'pos')
    RETURNING id INTO v_order_id;
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_order_id, 'qris', 30000);
  UPDATE orders SET status='paid', paid_at=now() WHERE id = v_order_id;
  UPDATE orders SET status='voided', voided_at=now(),
    voided_by=current_setting('s44.profile_id')::uuid, void_reason='test void s44' WHERE id = v_order_id;
  v_qris := resolve_mapping_account('SALE_PAYMENT_QRIS');
  SELECT count(*) INTO v_n FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.reference_type='sale_void' AND je.reference_id=v_order_id
      AND jel.account_id = v_qris AND jel.credit = 30000;
  PERFORM set_config('s44.t7_pass', (v_n = 1)::text, true);
END $$;
SELECT ok(current_setting('s44.t7_pass')::boolean, 'T7 void splits reversal by method (qris credit)');

SELECT * FROM finish();
ROLLBACK;
