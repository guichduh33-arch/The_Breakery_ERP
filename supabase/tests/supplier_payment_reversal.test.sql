-- ADR-048 : paiements fournisseurs datés, règlement groupé, contre-passation.
--   record_po_payment_v3, record_supplier_payment_v1, reverse_po_payment_v1.
-- Comptes, bons, paiements et écritures de ce test disparaissent avec le ROLLBACK.
BEGIN;
\ir helpers/payment_invoice.sql
SELECT no_plan();

CREATE TEMP TABLE spr(k text PRIMARY KEY, id text, d date);

DO $fixture$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();   -- super admin
  ma uuid := gen_random_uuid(); mp uuid := gen_random_uuid();   -- gestionnaire (paie, ne contre-passe pas)
  v_cat uuid; v_sup uuid; v_sup2 uuid; v_prod uuid;
  v_items jsonb;
  d_main date := GREATEST(date_trunc('month', current_date)::date, current_date - 3);
  d_prev date := (date_trunc('month', current_date) - interval '15 days')::date;
BEGIN
  INSERT INTO auth.users(id) VALUES (oa), (ma);
  INSERT INTO user_profiles(id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash) VALUES
    (op, oa, 'SUPER_ADMIN', 'SPR owner',   'SPR-O-'||left(op::text,8), true, extensions.crypt('246810', extensions.gen_salt('bf'))),
    (mp, ma, 'MANAGER',     'SPR manager', 'SPR-M-'||left(mp::text,8), true, extensions.crypt('135791', extensions.gen_salt('bf')));
  INSERT INTO user_permission_overrides(user_profile_id, permission_code, is_granted, reason)
    VALUES (mp, 'purchasing.po.pay', true, 'SPR coverage'), (mp, 'purchasing.po.create', true, 'SPR coverage')
    ON CONFLICT (user_profile_id, permission_code) DO UPDATE SET is_granted = true, expires_at = NULL;

  SELECT id INTO v_cat FROM categories ORDER BY (category_type = 'raw_material') DESC LIMIT 1;
  INSERT INTO suppliers(code, name, payment_terms_days, is_active)
    VALUES ('SPR-'||left(op::text,8), 'SPR supplier', 30, true) RETURNING id INTO v_sup;
  INSERT INTO suppliers(code, name, payment_terms_days, is_active)
    VALUES ('SPR2-'||left(op::text,8), 'SPR other supplier', 30, true) RETURNING id INTO v_sup2;
  INSERT INTO products(sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
    VALUES ('SPR-'||left(op::text,8), 'SPR product', v_cat, 5000, 0, 'kg', 1000, 'finished', true)
    RETURNING id INTO v_prod;

  PERFORM set_config('request.jwt.claim.sub', oa::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', oa::text, 'role', 'authenticated')::text, true);

  -- old = 100 000 (le plus ancien), new = 50 000, single = 30 000, prev = 40 000, other = autre fournisseur.
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 100, 'unit', 'kg', 'unit_cost', 1000));
  INSERT INTO spr VALUES ('old', (create_purchase_order_v3(p_supplier_id := v_sup, p_items := v_items,
    p_order_date := current_date - 10, p_payment_terms := 'credit', p_vat_rate := 0.0))->>'po_id', NULL);
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 50, 'unit', 'kg', 'unit_cost', 1000));
  INSERT INTO spr VALUES ('new', (create_purchase_order_v3(p_supplier_id := v_sup, p_items := v_items,
    p_order_date := current_date - 5, p_payment_terms := 'credit', p_vat_rate := 0.0))->>'po_id', NULL);
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 30, 'unit', 'kg', 'unit_cost', 1000));
  INSERT INTO spr VALUES ('single', (create_purchase_order_v3(p_supplier_id := v_sup, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0))->>'po_id', NULL);
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 40, 'unit', 'kg', 'unit_cost', 1000));
  INSERT INTO spr VALUES ('prev', (create_purchase_order_v3(p_supplier_id := v_sup, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0))->>'po_id', NULL);
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 10, 'unit', 'kg', 'unit_cost', 1000));
  INSERT INTO spr VALUES ('other', (create_purchase_order_v3(p_supplier_id := v_sup2, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0))->>'po_id', NULL);

  INSERT INTO spr VALUES ('sup', v_sup, NULL), ('oa', oa, NULL), ('ma', ma, NULL),
    ('d_main', NULL, d_main), ('d_prev', NULL, d_prev),
    ('k_group', gen_random_uuid(), NULL), ('k_rev', gen_random_uuid(), NULL);
END
$fixture$;

CREATE FUNCTION pg_temp.as_user(p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v uuid := (SELECT id::uuid FROM spr WHERE k = p_key);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v::text, 'role', 'authenticated')::text, true);
END $$;
CREATE FUNCTION pg_temp.v(p_key text) RETURNS uuid LANGUAGE sql AS $$ SELECT id::uuid FROM spr WHERE k = p_key $$;
CREATE FUNCTION pg_temp.dd(p_key text) RETURNS date LANGUAGE sql AS $$ SELECT d FROM spr WHERE k = p_key $$;

-- ─── 1. Date réelle ──────────────────────────────────────────────────────────
SELECT pg_temp.as_user('ma');
INSERT INTO spr SELECT 'pay_single', (record_po_payment_v3(pg_temp.v('single'), 30000, 'transfer', 'T1',
  gen_random_uuid(), (pg_temp.dd('d_main') + time '09:30')::timestamptz))->>'payment_id', NULL;
SELECT is((SELECT paid_at::date FROM purchase_payments WHERE id = pg_temp.v('pay_single')), pg_temp.dd('d_main'),
  'v3 : le paiement porte la date choisie');
SELECT is((SELECT entry_date FROM journal_entries WHERE reference_type = 'purchase_payment' AND reference_id = pg_temp.v('pay_single')),
  pg_temp.dd('d_main'), 'v3 : son écriture est datée du même jour');
SELECT ok(NOT has_function_privilege('anon', 'record_po_payment_v3(uuid,numeric,text,text,uuid,timestamptz)', 'execute'),
  'v3 : anon ne peut pas l''exécuter');
SELECT ok(to_regprocedure('record_po_payment_v2(uuid,numeric,text,text,uuid)') IS NULL, 'v2 supprimée');
SELECT ok(NOT has_function_privilege('authenticated',
  '_record_po_payment_internal_v2(uuid,numeric,text,text,uuid,uuid,timestamptz,uuid)', 'execute'),
  'le helper interne reste fermé aux comptes connectés');

-- ─── 2. Règlement groupé ─────────────────────────────────────────────────────
INSERT INTO spr SELECT 'grp_res', (record_supplier_payment_v1(pg_temp.v('sup'), ARRAY[pg_temp.v('new'), pg_temp.v('old')],
  120000, 'transfer', 'T2 transfer', (pg_temp.dd('d_main') + time '10:00')::timestamptz, pg_temp.v('k_group')))->>'payment_group_id', NULL;
SELECT is(pg_temp.v('grp_res'), pg_temp.v('k_group'), 'groupé : le groupe porte la clé de la saisie');
SELECT is((SELECT SUM(amount) FROM purchase_payments WHERE purchase_order_id = pg_temp.v('old')), 100000::numeric,
  'groupé : le bon le plus ancien est soldé en premier');
SELECT is((SELECT SUM(amount) FROM purchase_payments WHERE purchase_order_id = pg_temp.v('new')), 20000::numeric,
  'groupé : le reste va au bon suivant');
SELECT is((SELECT count(*)::int FROM journal_entries j JOIN purchase_payments p ON p.id = j.reference_id
            WHERE j.reference_type = 'purchase_payment' AND p.payment_group_id = pg_temp.v('k_group')
              AND j.entry_date = pg_temp.dd('d_main')), 2, 'groupé : une écriture par bon, à la date choisie');
SELECT is((record_supplier_payment_v1(pg_temp.v('sup'), ARRAY[pg_temp.v('new'), pg_temp.v('old')],
  120000, 'transfer', 'T2 transfer', now(), pg_temp.v('k_group')))->>'idempotent_replay', 'true',
  'groupé : la même clé rejoue');
SELECT is((SELECT count(*)::int FROM purchase_payments WHERE payment_group_id = pg_temp.v('k_group')), 2,
  'groupé : le rejeu n''ajoute aucune ligne');
SELECT throws_like($q$SELECT record_supplier_payment_v1(pg_temp.v('sup'), ARRAY[pg_temp.v('new')], 30001, 'cash', NULL, now(), gen_random_uuid())$q$,
  'overpayment_not_allowed%', 'groupé : refus au-delà du reste dû');
SELECT throws_like($q$SELECT record_supplier_payment_v1(pg_temp.v('sup'), ARRAY[pg_temp.v('new'), pg_temp.v('other')], 1000, 'cash', NULL, now(), gen_random_uuid())$q$,
  'po_supplier_mismatch%', 'groupé : refus d''un bon d''un autre fournisseur');
SELECT throws_like($q$SELECT record_supplier_payment_v1(pg_temp.v('sup'), ARRAY[pg_temp.v('old')], 1000, 'cash', NULL, now(), gen_random_uuid())$q$,
  'po_nothing_due%', 'groupé : refus d''un bon déjà soldé');
SELECT ok(NOT has_function_privilege('anon', 'record_supplier_payment_v1(uuid,uuid[],numeric,text,text,timestamptz,uuid)', 'execute'),
  'groupé : anon ne peut pas l''exécuter');

-- ─── 3. Contre-passation ─────────────────────────────────────────────────────
INSERT INTO spr SELECT 'pay_old', id, NULL FROM purchase_payments WHERE purchase_order_id = pg_temp.v('old');
SELECT throws_like($q$SELECT reverse_po_payment_v1(pg_temp.v('pay_old'), 'saisie en double', '135791', gen_random_uuid())$q$,
  'super_admin_only%', 'contre-passation : refusée hors super admin');
SELECT pg_temp.as_user('oa');
SELECT throws_like($q$SELECT reverse_po_payment_v1(pg_temp.v('pay_old'), 'x', '246810', gen_random_uuid())$q$,
  'reason_required%', 'contre-passation : motif obligatoire');
SELECT is((reverse_po_payment_v1(pg_temp.v('pay_old'), 'saisie en double', '000000', gen_random_uuid()))->>'error', 'invalid_pin',
  'contre-passation : un PIN faux est refusé sans lever');
SELECT is(jsonb_array_length((reverse_po_payment_v1(pg_temp.v('pay_old'), 'virement saisi deux fois', '246810', pg_temp.v('k_rev')))->'lines'), 2,
  'contre-passation : un paiement groupé se contre-passe en entier');
SELECT is((SELECT COALESCE(SUM(amount), 0) FROM purchase_payments WHERE purchase_order_id IN (pg_temp.v('old'), pg_temp.v('new'))), 0::numeric,
  'contre-passation : le reste dû des bons revient à leur total');
SELECT is((SELECT count(*)::int FROM journal_entries j JOIN purchase_payments r ON r.id = j.reference_id
            WHERE j.reference_type = 'purchase_payment' AND r.reversal_of_id IS NOT NULL
              AND r.payment_group_id = pg_temp.v('k_group') AND j.entry_date = pg_temp.dd('d_main')
              AND j.metadata->>'kind' = 'purchase_payment_reversal'), 2,
  'contre-passation : écritures inverses datées du jour d''origine');
SELECT is((SELECT SUM(l.debit - l.credit) FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
            JOIN purchase_payments p ON p.id = j.reference_id
            WHERE j.reference_type = 'purchase_payment' AND p.payment_group_id = pg_temp.v('k_group')
              AND l.account_id = resolve_mapping_account('PURCHASE_PAYABLE')), 0::numeric,
  'contre-passation : la dette fournisseur est rétablie');
SELECT is((SELECT count(*)::int FROM audit_logs WHERE action = 'po.payment_reversed'
            AND entity_id IN (pg_temp.v('old'), pg_temp.v('new')) AND metadata->>'reason' = 'virement saisi deux fois'), 2,
  'contre-passation : tracée dans le journal d''audit avec le motif');
SELECT is((reverse_po_payment_v1(pg_temp.v('pay_old'), 'virement saisi deux fois', '246810', pg_temp.v('k_rev')))->>'replayed', 'true',
  'contre-passation : la même clé rejoue');
SELECT throws_like($q$SELECT reverse_po_payment_v1(pg_temp.v('pay_old'), 'encore', '246810', gen_random_uuid())$q$,
  'payment_already_reversed%', 'contre-passation : une seule fois');
SELECT throws_like($q$SELECT reverse_po_payment_v1((SELECT id FROM purchase_payments WHERE reversal_of_id = pg_temp.v('pay_old')), 'encore', '246810', gen_random_uuid())$q$,
  'reversal_not_reversible%', 'contre-passation : une contre-passation ne se contre-passe pas');
SELECT lives_ok($q$SELECT record_po_payment_v3(pg_temp.v('old'), 100000, 'transfer', 'T3 bon', gen_random_uuid(), now())$q$,
  'contre-passation : le bon accepte un nouveau paiement');
SELECT throws_like($q$INSERT INTO purchase_payments(purchase_order_id, amount, method, idempotency_key) VALUES (pg_temp.v('new'), -5, 'cash', gen_random_uuid())$q$,
  '%purchase_payments_amount_check%', 'grand livre : une ligne négative exige un paiement d''origine');
SELECT ok(NOT has_function_privilege('anon', 'reverse_po_payment_v1(uuid,text,text,uuid)', 'execute'),
  'contre-passation : anon ne peut pas l''exécuter');

-- ─── 4. Période fermée ───────────────────────────────────────────────────────
INSERT INTO spr SELECT 'pay_prev', (record_po_payment_v3(pg_temp.v('prev'), 40000, 'cash', 'T4',
  gen_random_uuid(), (pg_temp.dd('d_prev') + time '11:00')::timestamptz))->>'payment_id', NULL;
UPDATE fiscal_periods SET status = 'closed' WHERE pg_temp.dd('d_prev') BETWEEN period_start AND period_end;
-- La garde de période lève P0004, la classe assert_failure : throws_like
-- (WHEN OTHERS) ne la couvre pas. Capture explicite.
CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'no error';
EXCEPTION WHEN OTHERS OR assert_failure THEN
  RETURN SQLERRM;
END $$;
SELECT ok(pg_temp.error_of($q$SELECT reverse_po_payment_v1(pg_temp.v('pay_prev'), 'mauvais mois', '246810', gen_random_uuid())$q$)
  LIKE 'period_locked%', 'contre-passation : refusée si la période d''origine est fermée');
SELECT ok(pg_temp.error_of($q$SELECT record_po_payment_v3(pg_temp.v('new'), 1, 'cash', NULL, gen_random_uuid(), (pg_temp.dd('d_prev') + time '12:00')::timestamptz)$q$)
  LIKE 'period_locked%', 'v3 : refus d''un paiement daté dans une période fermée');

SELECT * FROM finish();
ROLLBACK;
