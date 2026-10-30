-- Transaction indépendante extraite de b2b_invoice.test.sql.
BEGIN;
\ir helpers/customer_category.sql
\ir helpers/legacy_users.sql
SELECT plan(7);
SELECT has_function('public','get_b2b_invoice_v1', ARRAY['uuid'], 'get_b2b_invoice_v1 existe');

SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);
INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_tax_id, b2b_payment_terms_days, phone, email, b2b_credit_limit, b2b_current_balance, category_id)
VALUES ('ccc68009-0000-0000-0000-000000000009','S68 Read Co','b2b','PT Read','01.234.567.8-901.000',30,'+62811','a@b.co',NULL,0, current_setting('fixture.customer_category')::uuid)
ON CONFLICT (id) DO NOTHING;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold, track_inventory, deduct_stock, unit, is_display_item)
VALUES ('ddd68009-0000-0000-0000-000000000009','S68-RD','S68 Read',(SELECT id FROM categories LIMIT 1),10000,0,0,false,false,'pcs',false)
ON CONFLICT (id) DO NOTHING;
CREATE TEMP TABLE _o(oid uuid) ON COMMIT DROP;
DO $d$ DECLARE v jsonb; BEGIN
  v := create_b2b_order_v8('ccc68009-0000-0000-0000-000000000009',
        jsonb_build_array(jsonb_build_object('product_id','ddd68009-0000-0000-0000-000000000009','quantity',3,'unit_price',10000)),
        'Merci', NULL, gen_random_uuid());
  INSERT INTO _o VALUES ((v->>'order_id')::uuid);
END $d$;
CREATE TEMP TABLE _inv(j jsonb) ON COMMIT DROP;
INSERT INTO _inv SELECT get_b2b_invoice_v1((SELECT oid FROM _o));

SELECT ok((SELECT (j ? 'invoice') AND (j ? 'customer') AND (j ? 'lines') AND (j ? 'payment') FROM _inv),
  'shape : clés invoice/customer/lines/payment présentes');
SELECT ok((SELECT (j->'invoice'->>'tax_amount')::numeric FROM _inv) = 0, 'aucune taxe : tax_amount = 0');
SELECT matches((SELECT j->'invoice'->>'invoice_number' FROM _inv), '^INV/[0-9]{4}/[0-9]{5}$', 'invoice_number au bon format');
SELECT ok((SELECT jsonb_array_length(j->'lines') FROM _inv) >= 1, 'au moins une ligne');

SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP001'), true);
SELECT throws_ok(format('SELECT get_b2b_invoice_v1(%L)', (SELECT oid FROM _o)), 'P0003', NULL, 'sans b2b.read → P0003');
SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);
SELECT throws_ok(format('SELECT get_b2b_invoice_v1(%L)', COALESCE((SELECT id FROM orders WHERE order_type <> 'b2b' LIMIT 1), gen_random_uuid())),
  'P0002', NULL, 'commande non-B2B (ou introuvable) → P0002');

SELECT * FROM finish();
ROLLBACK;
