-- supabase/tests/s3_20_purchase_items_by_article.test.sql
-- S3-20 — le rapport des achats par article, calculé serveur et non tronqué.
--
-- Preuve demandée par le plan : les totaux égalent la somme des lignes au-delà
-- de 1 000 lignes ; chaque filtre restreint bien ; les brouillons et annulés
-- restent exclus. S'y ajoutent la quantité en unité de base, la comparaison à
-- la période précédente, la tendance par jour et la lecture paginée des lignes.
--
-- Fenêtre isolée en mars 2001 : aucune donnée réelle n'y tombe.
-- Runner : corps exécuté dans une enveloppe BEGIN … ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

DO $fix$
DECLARE
  v_sa UUID; v_sb UUID; v_c1 UUID; v_c2 UUID; v_p1 UUID; v_p2 UUID;
  v_po1 UUID; v_po2 UUID; v_po3 UUID; v_po4 UUID; v_po5 UUID;
BEGIN
  INSERT INTO suppliers (code, name) VALUES ('T_S320_A', 'T_S320 Supplier A') RETURNING id INTO v_sa;
  INSERT INTO suppliers (code, name) VALUES ('T_S320_B', 'T_S320 Supplier B') RETURNING id INTO v_sb;
  INSERT INTO categories (name, slug) VALUES ('T_S320 Flours', 't-s320-flours') RETURNING id INTO v_c1;
  INSERT INTO categories (name, slug) VALUES ('T_S320 Sugars', 't-s320-sugars') RETURNING id INTO v_c2;
  INSERT INTO products (sku, name, category_id, retail_price, unit)
  VALUES ('T_S320_P1', 'T_S320 Flour', v_c1, 0, 'kg') RETURNING id INTO v_p1;
  INSERT INTO products (sku, name, category_id, retail_price, unit)
  VALUES ('T_S320_P2', 'T_S320 Sugar', v_c2, 0, 'kg') RETURNING id INTO v_p2;

  -- PO1 : reçu, 1 005 lignes de P1 à 1 000 → 1 005 000, au-delà de l'ancien plafond.
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, received_date)
  VALUES ('T_S320_PO1', v_sa, 'received', '2001-03-02', '2001-03-05') RETURNING id INTO v_po1;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  SELECT v_po1, v_p1, 1, 'kg', 1000, 1 FROM generate_series(1, 1005);
  -- PO2 : en attente, 2 sacs de 25 kg de P2 à 50 000 → 100 000, 50 kg de base.
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date)
  VALUES ('T_S320_PO2', v_sb, 'pending', '2001-03-03') RETURNING id INTO v_po2;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES (v_po2, v_p2, 2, 'bag', 50000, 25);
  -- PO3 brouillon et PO4 annulé : exclus.
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date)
  VALUES ('T_S320_PO3', v_sa, 'draft', '2001-03-04') RETURNING id INTO v_po3;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES (v_po3, v_p1, 10, 'kg', 1000, 1);
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date)
  VALUES ('T_S320_PO4', v_sa, 'cancelled', '2001-03-04') RETURNING id INTO v_po4;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES (v_po4, v_p1, 10, 'kg', 1000, 1);
  -- PO5 : période précédente (19–28 février), 3 kg de P1 → 3 000.
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, received_date)
  VALUES ('T_S320_PO5', v_sa, 'received', '2001-02-25', '2001-02-25') RETURNING id INTO v_po5;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES (v_po5, v_p1, 3, 'kg', 1000, 1);

  -- Seconde fenêtre isolée (juin 2001) : P1 acheté en sac de 25 kg (reçu) puis
  -- en kilos (partiel) → unités mélangées, 30 kg de base, 1 000 le kilo.
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date, received_date)
  VALUES ('T_S320_PO6', v_sa, 'received', '2001-06-05', '2001-06-05') RETURNING id INTO v_po3;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES (v_po3, v_p1, 1, 'bag', 25000, 25);
  INSERT INTO purchase_orders (po_number, supplier_id, status, order_date)
  VALUES ('T_S320_PO7', v_sa, 'partial', '2001-06-06') RETURNING id INTO v_po4;
  INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base)
  VALUES (v_po4, v_p1, 5, 'kg', 1000, 1);

  PERFORM set_config('s320.sa', v_sa::text, true);
  PERFORM set_config('s320.sb', v_sb::text, true);
  PERFORM set_config('s320.c1', v_c1::text, true);
  PERFORM set_config('s320.p1', v_p1::text, true);
  PERFORM set_config('s320.p2', v_p2::text, true);
  PERFORM set_config('s320.owner', (SELECT auth_user_id::text FROM user_profiles
    WHERE role_code = 'SUPER_ADMIN' AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL
    ORDER BY created_at LIMIT 1), true);
  PERFORM set_config('s320.denied', (SELECT auth_user_id::text FROM user_profiles
    WHERE is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL
      AND NOT has_permission(auth_user_id, 'reports.inventory.read')
    ORDER BY created_at LIMIT 1), true);
END $fix$;

CREATE TEMP TABLE s320_results(n serial, tap text);
GRANT ALL ON s320_results TO authenticated;
GRANT USAGE ON SEQUENCE s320_results_n_seq TO authenticated;

-- Rapport de la période, filtres optionnels.
CREATE FUNCTION pg_temp.s320(p_supplier uuid DEFAULT NULL, p_category uuid DEFAULT NULL,
  p_product uuid DEFAULT NULL, p_status text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.get_purchase_items_v2('2001-03-01', '2001-03-10', p_supplier, p_category, p_product, p_status) $$;
GRANT EXECUTE ON FUNCTION pg_temp.s320(uuid, uuid, uuid, text) TO authenticated;
CREATE FUNCTION pg_temp.s320_item(r jsonb, p uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT i FROM jsonb_array_elements(r->'items') i WHERE i->>'product_id' = p::text $$;
GRANT EXECUTE ON FUNCTION pg_temp.s320_item(jsonb, uuid) TO authenticated;

-- Droits.
INSERT INTO s320_results(tap) SELECT hasnt_function('public', 'get_purchase_items_v1',
  'get_purchase_items_v1 is dropped');
INSERT INTO s320_results(tap) SELECT ok(
  NOT has_function_privilege('anon', 'public.get_purchase_items_v2(text,text,uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_purchase_item_lines_v1(text,text,uuid,uuid,text,integer,integer)', 'EXECUTE'),
  'anon cannot execute the report nor the lines');

SELECT pg_temp.authenticate_pin(current_setting('s320.owner')::uuid);
SET LOCAL ROLE authenticated;

-- Totaux non tronqués, brouillon et annulé exclus.
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320()->'summary'->>'total_value')::numeric, 1105000::numeric,
  'Total value sums every line beyond 1000, drafts and cancelled excluded');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320()->'summary'->>'line_count')::int, 1006,
  'Line count is not capped at 1000');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320()->'summary'->>'po_count')::int, 2,
  'Purchase orders counted without draft and cancelled');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320()->'summary'->>'supplier_count')::int, 2,
  'Suppliers counted by id');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320()->'summary'->>'product_count')::int, 2,
  'Two articles in the period');

-- Agrégat par article.
INSERT INTO s320_results(tap) SELECT is(pg_temp.s320()->'items'->0->>'product_id', current_setting('s320.p1'),
  'Articles are ranked by value');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320_item(pg_temp.s320(), current_setting('s320.p1')::uuid)->>'share_pct')::numeric,
  90.95::numeric, 'Share of the top article');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320_item(pg_temp.s320(), current_setting('s320.p2')::uuid)->>'base_quantity')::numeric,
  50::numeric, 'Quantity is summed in base units (2 bags × 25)');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320_item(pg_temp.s320(), current_setting('s320.p2')::uuid)->>'avg_unit_cost')::numeric,
  2000::numeric, 'Average unit cost per base unit');
INSERT INTO s320_results(tap) SELECT is(pg_temp.s320_item(pg_temp.s320(), current_setting('s320.p2')::uuid)->>'purchase_unit',
  'bag', 'Single purchase unit is returned');
INSERT INTO s320_results(tap) SELECT is(pg_temp.s320_item(pg_temp.s320(), current_setting('s320.p1')::uuid)->>'category_name',
  'T_S320 Flours', 'Category is returned');

-- Période précédente et tendance.
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320()->'summary'->>'previous_total_value')::numeric, 3000::numeric,
  'Previous period of the same length is compared');
INSERT INTO s320_results(tap) SELECT is(jsonb_array_length(pg_temp.s320()->'trend'), 10,
  'One trend point per day of the period');
INSERT INTO s320_results(tap) SELECT is((SELECT (t->>'previous_value')::numeric FROM jsonb_array_elements(pg_temp.s320()->'trend') t
  WHERE t->>'date' = '2001-03-07'), 3000::numeric, 'The matching previous day sits next to its current day');

-- Filtres.
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320(p_supplier => current_setting('s320.sb')::uuid)->'summary'->>'total_value')::numeric,
  100000::numeric, 'Supplier filter restricts');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320(p_category => current_setting('s320.c1')::uuid)->'summary'->>'total_value')::numeric,
  1005000::numeric, 'Category filter restricts');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320(p_product => current_setting('s320.p2')::uuid)->'summary'->>'product_count')::int,
  1, 'Article filter restricts');
INSERT INTO s320_results(tap) SELECT is((pg_temp.s320(p_status => 'pending')->'summary'->>'total_value')::numeric,
  100000::numeric, 'Status filter restricts');
INSERT INTO s320_results(tap) SELECT throws_ok($$SELECT pg_temp.s320(p_status => 'draft')$$, '22023', NULL,
  'A draft status filter is refused');

-- Lignes d'un article, paginées.
INSERT INTO s320_results(tap) SELECT ok(
  (public.get_purchase_item_lines_v1('2001-03-01','2001-03-10', current_setting('s320.p1')::uuid)->>'total_count')::int = 1005
  AND jsonb_array_length(public.get_purchase_item_lines_v1('2001-03-01','2001-03-10', current_setting('s320.p1')::uuid)->'lines') = 50
  AND jsonb_array_length(public.get_purchase_item_lines_v1('2001-03-01','2001-03-10', current_setting('s320.p1')::uuid,
        NULL, NULL, 50, 1000)->'lines') = 5
  AND public.get_purchase_item_lines_v1('2001-03-01','2001-03-10', current_setting('s320.p1')::uuid)->'lines'->0->>'received_date' = '2001-03-05',
  'Lines of one article are paginated and carry the receipt date');
-- Unités mélangées, statuts reçu et partiel, borne de 366 jours.
INSERT INTO s320_results(tap) SELECT ok(
  (public.get_purchase_items_v2('2001-06-01','2001-06-10')->'items'->0->'purchase_unit') = 'null'::jsonb
  AND (public.get_purchase_items_v2('2001-06-01','2001-06-10')->'items'->0->>'base_quantity')::numeric = 30
  AND (public.get_purchase_items_v2('2001-06-01','2001-06-10')->'items'->0->>'avg_unit_cost')::numeric = 1000,
  'Mixed purchase units: no single unit, quantity and cost in base units');
INSERT INTO s320_results(tap) SELECT ok(
  (public.get_purchase_items_v2('2001-06-01','2001-06-10', NULL, NULL, NULL, 'received')->'summary'->>'total_value')::numeric = 25000
  AND (public.get_purchase_items_v2('2001-06-01','2001-06-10', NULL, NULL, NULL, 'partial')->'summary'->>'total_value')::numeric = 5000,
  'Received and partial status filters restrict');
INSERT INTO s320_results(tap) SELECT is(
  public.get_purchase_items_v2('1999-01-01','2001-06-10')->'period'->>'start', '2000-06-09',
  'A range longer than 366 days is clamped to 366 days');
RESET ROLE;

SELECT pg_temp.authenticate_pin(current_setting('s320.denied')::uuid);
SET LOCAL ROLE authenticated;
INSERT INTO s320_results(tap) SELECT throws_ok($$SELECT pg_temp.s320()$$, '42501', NULL,
  'An account without reports.inventory.read is refused');
RESET ROLE;

SELECT tap FROM s320_results ORDER BY n;
SELECT * FROM finish();
ROLLBACK;
