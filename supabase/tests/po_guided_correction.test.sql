-- ADR-050 — Correction guidée d'un bon reçu et payé, par le super admin.
--   start_po_correction_v1, update_purchase_order_v3, champs calculés
--   po_paid_amount / po_payment_status.
-- Comptes, bons, réceptions, paiements et écritures disparaissent au ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
\ir helpers/payment_invoice.sql
SELECT plan(31);

CREATE TEMP TABLE pgc(k text PRIMARY KEY, id uuid);
CREATE FUNCTION pg_temp.v(p_key text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM pgc WHERE k = p_key $$;

DO $fixture$
DECLARE
  oa uuid := gen_random_uuid(); op uuid := gen_random_uuid();   -- super admin
  ma uuid := gen_random_uuid(); mp uuid := gen_random_uuid();   -- manager
  cat uuid := gen_random_uuid(); s uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  v_items jsonb; po uuid; l uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (oa), (ma);
  INSERT INTO user_profiles(id, auth_user_id, role_code, full_name, employee_code, is_active, pin_hash) VALUES
    (op, oa, 'SUPER_ADMIN', 'PGC owner',   'PGC-O-'||left(op::text,8), true, public.hash_pin('246810')),
    (mp, ma, 'MANAGER',     'PGC manager', 'PGC-M-'||left(mp::text,8), true, public.hash_pin('135791'));
  INSERT INTO categories(id, name, slug, category_type)
    VALUES (cat, 'PGC fixture', 'pgc-'||cat, 'raw_material');
  INSERT INTO suppliers(id, code, name, payment_terms_days, is_active)
    VALUES (s, 'PGC-'||left(s::text,8), 'PGC supplier', 30, true);
  INSERT INTO products(id, sku, name, category_id, retail_price, current_stock, cost_price,
    unit, product_type, is_active, track_inventory, deduct_stock)
    VALUES (p, 'PGC-'||left(p::text,8), 'PGC product', cat, 500, 10, 100, 'pcs', 'finished', true, true, true);

  PERFORM pg_temp.authenticate_pin(oa);
  -- Un carton de 10 : 10 en stock à 100 + 10 reçus à 200 donnent un coût moyen
  -- rond (150), que l'annulation ramène exactement à 100. Avec 20 reçus, le
  -- coût moyen arrondi au centime (166,67) revient à 100,01 : un arrondi de
  -- l'annulation de réception existante, hors du sujet de ce test.
  v_items := jsonb_build_array(jsonb_build_object(
    'product_id', p, 'quantity', 1, 'unit', 'box', 'unit_factor_to_base', 10, 'unit_cost', 2000));

  -- A : reçu en entier (10 pièces à 200) et payé en entier.
  po := (create_purchase_order_v3(p_supplier_id := s, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0)->>'po_id')::uuid;
  UPDATE purchase_order_items SET unit_factor_to_base = 10 WHERE po_id = po;
  SELECT id INTO STRICT l FROM purchase_order_items WHERE po_id = po;
  PERFORM receive_purchase_order_v8(po, jsonb_build_array(jsonb_build_object(
    'po_item_id', l, 'received_quantity', 1)), gen_random_uuid());
  PERFORM record_po_payment_v3(po, 2000, 'transfer', 'PGC-A', gen_random_uuid(), now() - interval '1 day');
  INSERT INTO pgc VALUES ('A', po);

  -- B : à recevoir, payé d'avance en partie.
  po := (create_purchase_order_v3(p_supplier_id := s, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0)->>'po_id')::uuid;
  PERFORM record_po_payment_v3(po, 1000, 'cash', 'PGC-B', gen_random_uuid(), now());
  INSERT INTO pgc VALUES ('B', po);

  -- C : à recevoir, rien à corriger. D : annulé. E : import historique.
  INSERT INTO pgc VALUES ('C', (create_purchase_order_v3(p_supplier_id := s, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0)->>'po_id')::uuid);
  po := (create_purchase_order_v3(p_supplier_id := s, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0)->>'po_id')::uuid;
  PERFORM cancel_purchase_order_v1(po, 'PGC fixture cancel');
  INSERT INTO pgc VALUES ('D', po);
  po := (create_purchase_order_v3(p_supplier_id := s, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0)->>'po_id')::uuid;
  UPDATE purchase_orders SET is_historical_import = true WHERE id = po;
  INSERT INTO pgc VALUES ('E', po);

  INSERT INTO pgc VALUES ('oa', oa), ('ma', ma), ('p', p), ('k1', gen_random_uuid());
END
$fixture$;

-- ─── Droits ──────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.start_po_correction_v1(uuid,text,text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.start_po_correction_v1(uuid,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.start_po_correction_v1(uuid,text,text,uuid)', 'EXECUTE'),
  'correction : authenticated seulement, ni anon ni PUBLIC');
SELECT ok(NOT has_function_privilege('anon', 'public.update_purchase_order_v3(uuid,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.update_purchase_order_v3(uuid,jsonb)', 'EXECUTE'),
  'update v3 : authenticated seulement');
SELECT ok(to_regprocedure('public.update_purchase_order_v2(uuid,jsonb)') IS NULL, 'update v2 supprimée');
SELECT ok(NOT has_function_privilege('anon', 'public.po_payment_status(public.purchase_orders)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.po_paid_amount(public.purchase_orders)', 'EXECUTE'),
  'champs calculés : fermés à anon');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
  FROM pg_proc WHERE oid = 'public.start_po_correction_v1(uuid,text,text,uuid)'::regprocedure),
  'correction : SECURITY DEFINER, search_path figé');

-- ─── Champs calculés avant correction ────────────────────────────────────────
SELECT is((SELECT po_payment_status(o) FROM purchase_orders o WHERE id = pg_temp.v('A')), 'paid', 'A : payé');
SELECT is((SELECT po_paid_amount(o) FROM purchase_orders o WHERE id = pg_temp.v('A')), 2000::numeric, 'A : 2000 payés');
SELECT is((SELECT po_payment_status(o) FROM purchase_orders o WHERE id = pg_temp.v('B')), 'partial', 'B : payé en partie');
SELECT is((SELECT po_payment_status(o) FROM purchase_orders o WHERE id = pg_temp.v('D')), 'none', 'D annulé : aucun statut');
SELECT is((SELECT po_payment_status(o) FROM purchase_orders o WHERE id = pg_temp.v('E')), 'imported', 'E : importé');

-- ─── Refus ───────────────────────────────────────────────────────────────────
SELECT pg_temp.authenticate_pin(pg_temp.v('ma'));
SELECT throws_ok($q$SELECT start_po_correction_v1(pg_temp.v('A'), 'wrong price', '135791', gen_random_uuid())$q$,
  '42501', 'super_admin_only', 'un manager est refusé');
SELECT pg_temp.authenticate_pin(pg_temp.v('oa'));
SELECT is((start_po_correction_v1(pg_temp.v('A'), 'wrong price', '000000', gen_random_uuid()))->>'error', 'invalid_pin',
  'un PIN faux est retourné, pas levé');
SELECT throws_ok($q$SELECT start_po_correction_v1(pg_temp.v('A'), '  ', '246810', gen_random_uuid())$q$,
  '22023', 'reason_required', 'un motif vide est refusé');
SELECT throws_like($q$SELECT update_purchase_order_v3(pg_temp.v('A'), '{"notes":"x"}'::jsonb)$q$,
  'po_locked: status=received%', 'v3 : un bon reçu reste verrouillé');
SELECT throws_like($q$SELECT update_purchase_order_v3(pg_temp.v('B'), '{"notes":"x"}'::jsonb)$q$,
  'po_locked: payment_exists%', 'v3 : un paiement vivant verrouille encore');
SELECT throws_ok($q$SELECT start_po_correction_v1(pg_temp.v('C'), 'nothing here', '246810', gen_random_uuid())$q$,
  'P0001', 'po_correction_nothing_to_correct', 'C : rien à corriger');
SELECT throws_like($q$SELECT start_po_correction_v1(pg_temp.v('D'), 'cancelled one', '246810', gen_random_uuid())$q$,
  'po_correction_invalid_status%', 'D : un bon annulé est refusé');
SELECT throws_ok($q$SELECT start_po_correction_v1(pg_temp.v('E'), 'imported one', '246810', gen_random_uuid())$q$,
  'P0003', 'po_correction_historical_import', 'E : un import historique est refusé');

-- ─── Correction de A ─────────────────────────────────────────────────────────
CREATE TEMP TABLE res AS
  SELECT start_po_correction_v1(pg_temp.v('A'), 'Wrong unit price on invoice', '246810', pg_temp.v('k1')) AS r;

SELECT ok((SELECT (r->>'ok')::boolean AND r->>'status' = 'pending'
  AND jsonb_array_length(r->'reversed_payment_ids') = 1 AND jsonb_array_length(r->'cancelled_grn_ids') = 1 FROM res),
  'A : un paiement contre-passé, une réception annulée, retour à pending');
SELECT is((SELECT status FROM purchase_orders WHERE id = pg_temp.v('A')), 'pending', 'A : statut pending');
SELECT is((SELECT SUM(amount) FROM purchase_payments WHERE purchase_order_id = pg_temp.v('A')), 0::numeric,
  'A : le grand livre des paiements se compense');
SELECT is((SELECT count(*)::int FROM goods_receipt_notes WHERE po_id = pg_temp.v('A') AND cancelled_at IS NULL), 0,
  'A : plus aucune réception active');
SELECT is((SELECT current_stock FROM products WHERE id = pg_temp.v('p')), 10::numeric, 'stock revenu à 10');
SELECT is((SELECT cost_price FROM products WHERE id = pg_temp.v('p')), 100::numeric, 'coût moyen revenu à 100');
SELECT is((SELECT po_payment_status(o) FROM purchase_orders o WHERE id = pg_temp.v('A')), 'unpaid', 'A : redevenu impayé');
SELECT ok(EXISTS (SELECT 1 FROM audit_logs WHERE action = 'po.correction_started' AND entity_id = pg_temp.v('A')
  AND metadata->>'reason' = 'Wrong unit price on invoice'), 'A : la correction est tracée avec son motif');

SELECT ok((SELECT (r2->>'replayed')::boolean AND r2->'reversed_payment_ids' = (SELECT r->'reversed_payment_ids' FROM res)
  FROM (SELECT start_po_correction_v1(pg_temp.v('A'), 'Wrong unit price on invoice', '246810', pg_temp.v('k1')) r2) x),
  'rejeu : même clé, même résultat');
SELECT is((SELECT count(*)::int FROM purchase_payments WHERE purchase_order_id = pg_temp.v('A')), 2,
  'rejeu : aucune ligne ajoutée');

SELECT is((update_purchase_order_v3(pg_temp.v('A'), jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
  'product_id', pg_temp.v('p'), 'quantity', 1, 'unit', 'box', 'unit_factor_to_base', 10, 'unit_cost', 1800)))))->>'total_amount',
  '1800.00', 'v3 : après correction, A s''édite');

-- ─── Correction de B (paiement seul) ─────────────────────────────────────────
SELECT ok((SELECT (r->>'ok')::boolean AND jsonb_array_length(r->'reversed_payment_ids') = 1
  AND jsonb_array_length(r->'cancelled_grn_ids') = 0
  FROM (SELECT start_po_correction_v1(pg_temp.v('B'), 'Paid the wrong order', '246810', gen_random_uuid()) r) x),
  'B : le paiement d''avance est contre-passé, aucune réception touchée');
SELECT is((SELECT po_payment_status(o) FROM purchase_orders o WHERE id = pg_temp.v('B')), 'unpaid', 'B : redevenu impayé');

SELECT * FROM finish();
ROLLBACK;
