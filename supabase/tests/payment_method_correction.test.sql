-- ADR-046 : le super admin corrige le moyen d'un règlement de vente
-- (correct_order_payment_method_v1). Comptes, sessions, commandes et écritures
-- de ce test disparaissent avec le ROLLBACK.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE pmc_results(seq serial, tap text);

DO $fixture$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();     -- super admin
  ca uuid := gen_random_uuid(); cp uuid := gen_random_uuid();     -- caissier 1
  c2a uuid := gen_random_uuid(); c2p uuid := gen_random_uuid();   -- caissier 2
  t uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o4 uuid := gen_random_uuid();
  o5 uuid := gen_random_uuid(); o6 uuid := gen_random_uuid(); o7 uuid := gen_random_uuid();
  o8 uuid := gen_random_uuid(); o9 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  v_line uuid;
  -- Compte espèces « d'avant » : tout compte autre que le mapping courant.
  v_legacy uuid := (SELECT id FROM accounts WHERE code = CASE
    WHEN (SELECT code FROM accounts WHERE id = resolve_mapping_account('SALE_PAYMENT_CASH')) = '1110' THEN '1119' ELSE '1110' END);
BEGIN
  INSERT INTO auth.users(id) VALUES (oa), (ca), (c2a);
  INSERT INTO user_profiles(id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash) VALUES
    (op, oa, 'SUPER_ADMIN', 'PMC owner', 'PMC-O-'||left(op::text,8), true, extensions.crypt('246810', extensions.gen_salt('bf'))),
    (cp, ca, 'CASHIER', 'PMC cashier', 'PMC-C-'||left(cp::text,8), true, extensions.crypt('135791', extensions.gen_salt('bf'))),
    (c2p, c2a, 'CASHIER', 'PMC cashier 2', 'PMC-D-'||left(c2p::text,8), true, extensions.crypt('135792', extensions.gen_salt('bf')));
  INSERT INTO user_permission_overrides(user_profile_id, permission_code, is_granted, reason)
    VALUES (cp, 'shift.close', true, 'PMC coverage'), (c2p, 'shift.close', true, 'PMC coverage')
    ON CONFLICT (user_profile_id, permission_code) DO UPDATE SET is_granted = true, expires_at = NULL;
  INSERT INTO lan_devices(id, code, name, device_type, is_active) VALUES
    (t, 'PMC-'||left(t::text,8), 'PMC terminal', 'pos', true),
    (t2, 'PMC-'||left(t2::text,8), 'PMC terminal 2', 'pos', true);
  INSERT INTO pos_sessions(id, opened_by, opening_cash, status, terminal_id) VALUES
    (s1, cp, 100000, 'open', t), (s2, c2p, 100000, 'open', t2);

  -- Les commandes naissent en attente : l'écriture de vente se pose au passage
  -- à « paid », une ligne par règlement.
  INSERT INTO orders(id, order_number, session_id, status, created_via, order_type, subtotal, tax_amount, total) VALUES
    (o1, 'PMC1-'||left(o1::text,6), s1, 'pending_payment', 'pos', 'take_out', 50000, 0, 50000),
    (o2, 'PMC2-'||left(o2::text,6), s1, 'pending_payment', 'pos', 'take_out', 30000, 0, 30000),
    (o8, 'PMC8-'||left(o8::text,6), s1, 'pending_payment', 'pos', 'take_out', 10000, 0, 10000),
    (o6, 'PMC6-'||left(o6::text,6), s1, 'pending_payment', 'pos', 'take_out', 15000, 0, 15000),
    (o3, 'PMC3-'||left(o3::text,6), s1, 'pending_payment', 'pos', 'take_out', 12000, 0, 12000),
    (o4, 'PMC4-'||left(o4::text,6), s2, 'pending_payment', 'pos', 'take_out', 20000, 0, 20000),
    (o5, 'PMC5-'||left(o5::text,6), s2, 'pending_payment', 'pos', 'take_out', 25000, 0, 25000);
  INSERT INTO order_payments(order_id, session_id, method, amount, cash_received, change_given) VALUES
    (o1, s1, 'cash', 50000, 60000, 10000), (o2, s1, 'qris', 30000, NULL, NULL),
    (o8, s1, 'card', 10000, NULL, NULL), (o6, s1, 'card', 15000, NULL, NULL),
    (o3, s1, 'cash', 12000, 12000, 0),
    (o4, s2, 'cash', 20000, 20000, 0), (o5, s2, 'qris', 25000, NULL, NULL);
  UPDATE orders SET status = 'paid', paid_at = now() WHERE id IN (o1, o2, o8, o6, o4, o5, o3);
  -- o3 : vente passée quand les espèces allaient sur un autre compte (mapping
  -- repointé depuis). Sa ligne de règlement porte l'ancien compte.
  UPDATE journal_entry_lines SET account_id = v_legacy
   WHERE description = 'Payment receipt (cash)'
     AND journal_entry_id = (SELECT id FROM journal_entries WHERE reference_type = 'sale' AND reference_id = o3);
  PERFORM set_config('pmc.legacy', v_legacy::text, true);

  -- Commande annulée (hors shift, pour ne pas fausser les attendus des
  -- clôtures) et commande importée.
  INSERT INTO orders(id, order_number, status, created_via, order_type, subtotal, tax_amount, total,
                     voided_at, voided_by, void_reason)
    VALUES (o7, 'PMC7-'||left(o7::text,6), 'voided', 'tablet', 'take_out', 5000, 0, 5000, now(), cp, 'PMC fixture');
  INSERT INTO order_payments(order_id, method, amount) VALUES (o7, 'cash', 5000);
  INSERT INTO orders(id, order_number, status, created_via, order_type, subtotal, tax_amount, total, is_historical_import)
    VALUES (o9, 'PMC9-'||left(o9::text,6), 'paid', 'import', 'take_out', 7000, 0, 7000, true);
  INSERT INTO order_payments(order_id, method, amount) VALUES (o9, 'cash', 7000);

  -- Commande remboursée en partie.
  INSERT INTO refunds(id, refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
    VALUES (r, 'PMC-R-'||left(r::text,6), o6, s1, 5000, 0, 'PMC fixture', cp, cp, false);

  -- Règlement carte déjà rapproché : sa ligne 1116 est portée en transit.
  SELECT l.id INTO v_line FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
   WHERE j.reference_type = 'sale' AND j.reference_id = o8
     AND l.account_id = resolve_mapping_account('SALE_PAYMENT_DEBIT');
  INSERT INTO bank_reconciliations(id, account_id, period_start, period_end, currency, status, created_by)
    VALUES (gen_random_uuid(), resolve_mapping_account('SALE_PAYMENT_TRANSFER'), '2000-01-01', '2000-01-31', 'IDR', 'draft', op)
    RETURNING id INTO r;
  INSERT INTO bank_reconciliation_transit(reconciliation_id, gl_line_id, reason) VALUES (r, v_line, 'PMC fixture');

  PERFORM set_config('pmc.s1', s1::text, true);
  PERFORM set_config('pmc.s2', s2::text, true);
  PERFORM set_config('pmc.op', op::text, true);
  PERFORM set_config('pmc.o1', o1::text, true);
  PERFORM set_config('pmc.o2', o2::text, true);
  PERFORM set_config('pmc.o4', o4::text, true);
  PERFORM set_config('pmc.o5', o5::text, true);
  PERFORM set_config('pmc.p1', (SELECT id::text FROM order_payments WHERE order_id = o1), true);
  PERFORM set_config('pmc.p2', (SELECT id::text FROM order_payments WHERE order_id = o2), true);
  PERFORM set_config('pmc.p4', (SELECT id::text FROM order_payments WHERE order_id = o4), true);
  PERFORM set_config('pmc.p5', (SELECT id::text FROM order_payments WHERE order_id = o5), true);
  PERFORM set_config('pmc.p6', (SELECT id::text FROM order_payments WHERE order_id = o6), true);
  PERFORM set_config('pmc.p7', (SELECT id::text FROM order_payments WHERE order_id = o7), true);
  PERFORM set_config('pmc.p8', (SELECT id::text FROM order_payments WHERE order_id = o8), true);
  PERFORM set_config('pmc.p9', (SELECT id::text FROM order_payments WHERE order_id = o9), true);
  PERFORM set_config('pmc.p3', (SELECT id::text FROM order_payments WHERE order_id = o3), true);
  PERFORM set_config('pmc.k1', gen_random_uuid()::text, true);
  PERFORM set_config('pmc.owner', jsonb_build_object('sub', oa, 'role', 'authenticated')::text, true);
  PERFORM set_config('pmc.cashier', jsonb_build_object('sub', ca, 'role', 'authenticated')::text, true);
  PERFORM set_config('pmc.cashier2', jsonb_build_object('sub', c2a, 'role', 'authenticated')::text, true);
END $fixture$;

INSERT INTO pmc_results(tap) SELECT is((SELECT count(*) FROM journal_entries
  WHERE reference_type = 'sale' AND reference_id = current_setting('pmc.o1')::uuid), 1::bigint,
  'Fixture: the paid order has its sale entry');

-- Refus d'accès.
SELECT set_config('request.jwt.claims', current_setting('pmc.cashier'), true);
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p1'), 'qris', 'Wrong key', '135791', gen_random_uuid()), '42501', 'super_admin_only',
  'A cashier cannot correct a payment method');
SELECT set_config('request.jwt.claims', current_setting('pmc.owner'), true);
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,NULL,%L)',
  current_setting('pmc.p1'), 'qris', 'Wrong key', gen_random_uuid()), 'P0001', 'pin_required', 'The PIN is required');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p1'), 'qris', '  ', '246810', gen_random_uuid()), '22023', 'reason_required', 'A reason is required');
INSERT INTO pmc_results(tap) SELECT is(public.correct_order_payment_method_v1(current_setting('pmc.p1')::uuid, 'qris',
  'Wrong key', '000000', gen_random_uuid())->>'error', 'invalid_pin', 'A wrong PIN is returned, not raised');
INSERT INTO pmc_results(tap) SELECT ok((SELECT failed_login_attempts > 0 FROM user_profiles WHERE id = current_setting('pmc.op')::uuid),
  'The wrong PIN is counted for the lockout');
UPDATE user_profiles SET failed_login_attempts = 0, locked_until = NULL WHERE id = current_setting('pmc.op')::uuid;

-- Refus métier.
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p1'), 'cash', 'Same', '246810', gen_random_uuid()), '22023', 'same_method', 'The same method is refused');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p1'), 'store_credit', 'Credit', '246810', gen_random_uuid()), 'P0001', 'store_credit_not_correctable',
  'Store credit is refused');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p7'), 'qris', 'Voided', '246810', gen_random_uuid()), 'P0001', 'order_voided', 'A voided order is refused');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p6'), 'qris', 'Refunded', '246810', gen_random_uuid()), 'P0001', 'order_refunded',
  'A partly refunded order is refused');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p9'), 'qris', 'Imported', '246810', gen_random_uuid()), 'P0001', 'imported_sale_not_correctable',
  'An imported sale is refused');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p8'), 'qris', 'Reconciled', '246810', gen_random_uuid()), 'P0001', 'payment_already_reconciled',
  'A payment already reconciled with the bank is refused');

-- Shift ouvert : espèces -> QRIS, débit 1115 / crédit 1119.
CREATE TEMP TABLE pmc_c1 AS SELECT public.correct_order_payment_method_v1(current_setting('pmc.p1')::uuid, 'qris',
  'Customer paid by QRIS', '246810', current_setting('pmc.k1')::uuid) AS r;
INSERT INTO pmc_results(tap) SELECT ok((SELECT r->>'ok' = 'true' AND r->>'session_closed' = 'false' FROM pmc_c1),
  'Open shift: the correction succeeds');
INSERT INTO pmc_results(tap) SELECT ok((SELECT method = 'qris' AND cash_received IS NULL AND change_given IS NULL
  FROM order_payments WHERE id = current_setting('pmc.p1')::uuid), 'The payment becomes QRIS, cash fields cleared');
INSERT INTO pmc_results(tap) SELECT ok((SELECT
    bool_and(CASE WHEN l.debit > 0 THEN l.account_id = resolve_mapping_account('SALE_PAYMENT_QRIS')
                  ELSE l.account_id = resolve_mapping_account('SALE_PAYMENT_CASH') END)
    AND sum(l.debit) = 50000 AND sum(l.credit) = 50000 AND count(*) = 2
    AND bool_and(j.reference_type = 'sale' AND j.metadata->>'kind' = 'payment_method_correction')
  FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
  WHERE j.id = (SELECT (r->>'journal_entry_id')::uuid FROM pmc_c1)),
  'Open shift: the correction entry debits QRIS clearing and credits the cash drawer');
INSERT INTO pmc_results(tap) SELECT ok((SELECT j.entry_date = (SELECT entry_date FROM journal_entries
    WHERE reference_type = 'sale' AND reference_id = current_setting('pmc.o1')::uuid AND metadata->>'kind' IS NULL)
  FROM journal_entries j WHERE j.id = (SELECT (r->>'journal_entry_id')::uuid FROM pmc_c1)),
  'The correction entry is dated like the original sale entry');
INSERT INTO pmc_results(tap) SELECT is((SELECT count(*) FROM journal_entries WHERE reference_type = 'sale'
  AND reference_id = current_setting('pmc.o1')::uuid AND metadata->>'kind' IS NULL), 1::bigint,
  'The original sale entry is untouched and still alone');

-- Rejeu et clé réutilisée.
INSERT INTO pmc_results(tap) SELECT ok((SELECT r->>'replayed' = 'true'
    AND r->>'correction_id' = (SELECT r->>'correction_id' FROM pmc_c1)
  FROM (SELECT public.correct_order_payment_method_v1(current_setting('pmc.p1')::uuid, 'qris',
    'Customer paid by QRIS', '246810', current_setting('pmc.k1')::uuid) AS r) x),
  'A replay returns the first result');
INSERT INTO pmc_results(tap) SELECT is((SELECT count(*) FROM payment_method_corrections
  WHERE payment_id = current_setting('pmc.p1')::uuid), 1::bigint, 'The replay records nothing new');
INSERT INTO pmc_results(tap) SELECT throws_ok(format('SELECT public.correct_order_payment_method_v1(%L,%L,%L,%L,%L)',
  current_setting('pmc.p2'), 'card', 'Other payment', '246810', current_setting('pmc.k1')), '22023', 'idempotency_key_reused',
  'A key reused for another payment is refused');

-- QRIS -> GoPay : même compte, aucune écriture.
CREATE TEMP TABLE pmc_c2 AS SELECT public.correct_order_payment_method_v1(current_setting('pmc.p2')::uuid, 'gopay',
  'Paid with GoPay', '246810', gen_random_uuid()) AS r;
INSERT INTO pmc_results(tap) SELECT ok((SELECT r->>'ok' = 'true' AND r->>'journal_entry_id' IS NULL FROM pmc_c2)
  AND (SELECT method = 'gopay' FROM order_payments WHERE id = current_setting('pmc.p2')::uuid),
  'Same clearing account: the method changes without an entry');

-- Mapping repointé depuis la vente : la correction crédite le compte réellement débité.
CREATE TEMP TABLE pmc_c3 AS SELECT public.correct_order_payment_method_v1(current_setting('pmc.p3')::uuid, 'card',
  'Legacy cash account', '246810', gen_random_uuid()) AS r;
INSERT INTO pmc_results(tap) SELECT ok((SELECT
    bool_and(CASE WHEN l.debit > 0 THEN l.account_id = resolve_mapping_account('SALE_PAYMENT_DEBIT')
                  ELSE l.account_id = current_setting('pmc.legacy')::uuid END) AND count(*) = 2
  FROM journal_entry_lines l WHERE l.journal_entry_id = (SELECT (r->>'journal_entry_id')::uuid FROM pmc_c3)),
  'Remapped cash account: the correction credits the account the sale really debited');

-- La clôture du shift 1 lit le moyen corrigé : l'attendu espèces ne compte plus o1.
SELECT set_config('request.jwt.claims', current_setting('pmc.cashier'), true);
SELECT public.close_shift_v15(current_setting('pmc.s1')::uuid, 100000);
INSERT INTO pmc_results(tap) SELECT is((SELECT expected_cash FROM pos_sessions WHERE id = current_setting('pmc.s1')::uuid),
  100000::numeric(15,2), 'A close after the correction expects no cash from the corrected sale');

-- Shift 2 clôturé avec les erreurs du caissier : o4 noté espèces (payé QRIS),
-- o5 noté QRIS (payé espèces). Tiroir compté 125 000, attendu 120 000.
SELECT set_config('request.jwt.claims', current_setting('pmc.cashier2'), true);
-- L'écart de +5 000 dépasse les seuils : note, approbateur et PIN.
SELECT public.close_shift_v15(current_setting('pmc.s2')::uuid, 125000, 'PMC variance', NULL,
  current_setting('pmc.op')::uuid, '246810');
CREATE TEMP TABLE pmc_frozen AS SELECT closing_payment_totals, closing_sales_total, expected_cash, variance_total
  FROM pos_sessions WHERE id = current_setting('pmc.s2')::uuid;
SELECT set_config('request.jwt.claims', current_setting('pmc.owner'), true);
CREATE TEMP TABLE pmc_c4 AS SELECT public.correct_order_payment_method_v1(current_setting('pmc.p4')::uuid, 'qris',
  'Customer paid by QRIS', '246810', gen_random_uuid()) AS r;
CREATE TEMP TABLE pmc_c5 AS SELECT public.correct_order_payment_method_v1(current_setting('pmc.p5')::uuid, 'cash',
  'Customer paid cash', '246810', gen_random_uuid()) AS r;
INSERT INTO pmc_results(tap) SELECT ok((SELECT r->>'session_closed' = 'true' FROM pmc_c4)
  AND (SELECT r->>'session_closed' = 'true' FROM pmc_c5), 'Closed shift: both corrections succeed');
INSERT INTO pmc_results(tap) SELECT ok((SELECT
    bool_and(CASE WHEN l.debit > 0 THEN l.account_id = resolve_mapping_account('SALE_PAYMENT_QRIS')
                  ELSE l.account_id = resolve_mapping_account('SHIFT_CASH_VARIANCE_EXPENSE') END)
  FROM journal_entry_lines l WHERE l.journal_entry_id = (SELECT (r->>'journal_entry_id')::uuid FROM pmc_c4)),
  'Closed shift, cash -> QRIS: debit QRIS clearing, credit (reduce) the cash shortage expense; drawer untouched');
INSERT INTO pmc_results(tap) SELECT ok((SELECT
    bool_and(CASE WHEN l.debit > 0 THEN l.account_id = resolve_mapping_account('SHIFT_CASH_VARIANCE_INCOME')
                  ELSE l.account_id = resolve_mapping_account('SALE_PAYMENT_QRIS') END)
  FROM journal_entry_lines l WHERE l.journal_entry_id = (SELECT (r->>'journal_entry_id')::uuid FROM pmc_c5)),
  'Closed shift, QRIS -> cash: debit (reduce) the cash overage income, credit QRIS clearing');
INSERT INTO pmc_results(tap) SELECT ok((SELECT cash_received = 25000 AND change_given = 0
  FROM order_payments WHERE id = current_setting('pmc.p5')::uuid), 'A payment corrected to cash carries its amount as received');
-- Écart net : la clôture avait constaté +5 000 ; les deux corrections le ramènent à zéro.
INSERT INTO pmc_results(tap) SELECT is((SELECT sum(l.credit - l.debit) FROM journal_entry_lines l
  JOIN journal_entries j ON j.id = l.journal_entry_id
  WHERE l.account_id IN (resolve_mapping_account('SHIFT_CASH_VARIANCE_INCOME'), resolve_mapping_account('SHIFT_CASH_VARIANCE_EXPENSE'))
    AND ((j.reference_type = 'shift_close' AND j.reference_id = current_setting('pmc.s2')::uuid)
      OR j.id IN ((SELECT (r->>'journal_entry_id')::uuid FROM pmc_c4), (SELECT (r->>'journal_entry_id')::uuid FROM pmc_c5)))),
  0::numeric, 'Variance accounts net to zero: +5 000 overage, +20 000 and -25 000 from the corrections');
INSERT INTO pmc_results(tap) SELECT ok((SELECT f.closing_payment_totals = s.closing_payment_totals
    AND f.closing_sales_total = s.closing_sales_total AND f.expected_cash = s.expected_cash
    AND f.variance_total = s.variance_total
  FROM pmc_frozen f, pos_sessions s WHERE s.id = current_setting('pmc.s2')::uuid),
  'The frozen shift totals do not move (ADR-046 §7)');

-- Trace d'audit.
INSERT INTO pmc_results(tap) SELECT ok((SELECT actor_id = current_setting('pmc.op')::uuid
    AND entity_type = 'orders' AND metadata->>'reason' = 'Customer paid by QRIS'
    AND payload->'before'->>'method' = 'cash' AND payload->'after'->>'method' = 'qris'
  FROM audit_logs WHERE action = 'order.payment_method_corrected' AND entity_id = current_setting('pmc.o1')::uuid),
  'The audit log carries the super admin profile, the reason, before and after');

-- Annulation après correction : chaque compte de la vente revient à zéro.
UPDATE orders SET status = 'voided', voided_at = now(), voided_by = current_setting('pmc.op')::uuid,
  void_reason = 'PMC void after correction' WHERE id = current_setting('pmc.o1')::uuid;
INSERT INTO pmc_results(tap) SELECT is((SELECT count(*) FROM (
  SELECT l.account_id FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
   WHERE j.reference_type IN ('sale', 'sale_void') AND j.reference_id = current_setting('pmc.o1')::uuid
   GROUP BY l.account_id HAVING sum(l.debit) - sum(l.credit) <> 0) x), 0::bigint,
  'A void after the correction nets every account of the sale to zero');

-- Droits.
INSERT INTO pmc_results(tap) SELECT ok(NOT has_function_privilege('anon',
  'public.correct_order_payment_method_v1(uuid,payment_method,text,text,uuid)', 'EXECUTE'),
  'anon cannot execute correct_order_payment_method_v1');
INSERT INTO pmc_results(tap) SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_method_corrections', 'INSERT'),
  'authenticated cannot write the corrections table');

SELECT jsonb_build_object('tap', (SELECT jsonb_agg(tap ORDER BY seq) FROM pmc_results),
  'finish', (SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
