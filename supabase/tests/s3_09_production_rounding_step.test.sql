-- supabase/tests/s3_09_production_rounding_step.test.sql
-- S3-09 — la suggestion de production s'arrondit au pas métier du produit.
--
-- Preuve demandée par le plan : un besoin de 17 avec un pas de 12 suggère 24 ;
-- un produit sans pas garde l'arrondi entier. Fixture : 40 unités vendues hier,
-- stock 0, couverture 3 jours sur 7 jours de recul → ROUND(40 / 7 × 3) = 17.
--
-- Runner : corps exécuté dans une enveloppe BEGIN … ROLLBACK.
BEGIN;
\ir helpers/released_report_days.sql
\ir helpers/pin_session.sql
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

DO $fix$
DECLARE
  v_cat UUID; v_bun UUID; v_flour UUID; v_session UUID; v_order UUID; v_opener UUID;
BEGIN
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, product_type, current_stock, is_active)
  VALUES ('T_S309_BUN', 'T_S309 Bun', v_cat, 5000, 'finished', 0, true) RETURNING id INTO v_bun;
  INSERT INTO products (sku, name, category_id, retail_price, product_type, current_stock, is_active)
  VALUES ('T_S309_FLOUR', 'T_S309 Flour', v_cat, 0, 'finished', 100, true) RETURNING id INTO v_flour;
  INSERT INTO recipes (product_id, material_id, quantity, unit) VALUES (v_bun, v_flour, 50, 'g');

  SELECT id INTO v_opener FROM user_profiles WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status)
  VALUES (gen_random_uuid(), v_opener, now() - interval '1 day', 0, 'open') RETURNING id INTO v_session;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at, created_via, session_id)
  VALUES ('T_S309_O1', 'dine_in', 'completed', 200000, 0, 200000, now() - interval '1 day', 'pos', v_session)
  RETURNING id INTO v_order;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, created_at)
  VALUES (v_order, v_bun, 'T_S309 Bun', 5000, 40, 200000, now() - interval '1 day');

  PERFORM set_config('s309.bun', v_bun::text, true);
  PERFORM set_config('s309.owner', (SELECT auth_user_id::text FROM user_profiles
    WHERE role_code = 'SUPER_ADMIN' AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL
    ORDER BY created_at LIMIT 1), true);
  PERFORM set_config('s309.cashier', (SELECT auth_user_id::text FROM user_profiles
    WHERE is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL
      AND NOT has_permission(auth_user_id, 'products.update')
    ORDER BY created_at LIMIT 1), true);
  PERFORM pg_temp.fixture_released_days(current_date - 30, current_date);
END $fix$;

CREATE TEMP TABLE s309_results(n serial, tap text);
GRANT ALL ON s309_results TO authenticated;
GRANT USAGE ON SEQUENCE s309_results_n_seq TO authenticated;

CREATE FUNCTION pg_temp.s309_suggested() RETURNS numeric LANGUAGE sql AS $$
  SELECT suggested_quantity FROM public.get_production_suggestions_v5(7, 3, 7)
  WHERE product_id = current_setting('s309.bun')::uuid $$;
GRANT EXECUTE ON FUNCTION pg_temp.s309_suggested() TO authenticated;

-- Schéma et droits.
INSERT INTO s309_results(tap) SELECT has_column('public', 'products', 'production_rounding_step',
  'products.production_rounding_step exists');
INSERT INTO s309_results(tap) SELECT hasnt_function('public', 'get_production_suggestions_v4',
  'get_production_suggestions_v4 is dropped');
INSERT INTO s309_results(tap) SELECT ok(
  NOT has_function_privilege('anon', 'public.set_production_rounding_step_v1(uuid,numeric)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_production_suggestions_v5(integer,integer,integer)', 'EXECUTE'),
  'anon cannot execute the setter nor the suggestions');

-- Propriétaire : sans pas, puis pas de 12, de 5, puis effacé.
SELECT pg_temp.authenticate_pin(current_setting('s309.owner')::uuid);
SET LOCAL ROLE authenticated;
INSERT INTO s309_results(tap) SELECT is(pg_temp.s309_suggested(), 17::numeric,
  'Without a step the suggestion keeps the whole-number rounding (17)');
INSERT INTO s309_results(tap) SELECT lives_ok(
  format('SELECT public.set_production_rounding_step_v1(%L, 12)', current_setting('s309.bun')),
  'Owner sets a step of 12');
INSERT INTO s309_results(tap) SELECT is(pg_temp.s309_suggested(), 24::numeric,
  'A need of 17 with a step of 12 suggests 24');
INSERT INTO s309_results(tap) SELECT is((SELECT production_rounding_step FROM public.get_production_suggestions_v5(7,3,7)
  WHERE product_id = current_setting('s309.bun')::uuid), 12::numeric, 'The step is returned to the screen');
SELECT public.set_production_rounding_step_v1(current_setting('s309.bun')::uuid, 5);
INSERT INTO s309_results(tap) SELECT is(pg_temp.s309_suggested(), 20::numeric,
  'A need of 17 with a step of 5 suggests 20');
INSERT INTO s309_results(tap) SELECT throws_ok(
  format('SELECT public.set_production_rounding_step_v1(%L, 0)', current_setting('s309.bun')),
  '22023', 'invalid_rounding_step', 'A zero step is refused');
INSERT INTO s309_results(tap) SELECT throws_ok(
  format('SELECT public.set_production_rounding_step_v1(%L, 0.0004)', current_setting('s309.bun')),
  '22023', 'invalid_rounding_step', 'A step that rounds to zero at 3 decimals is refused');
SELECT public.set_production_rounding_step_v1(current_setting('s309.bun')::uuid, NULL);
INSERT INTO s309_results(tap) SELECT is(pg_temp.s309_suggested(), 17::numeric,
  'Clearing the step restores the whole-number rounding');
RESET ROLE;

INSERT INTO s309_results(tap) SELECT is((SELECT count(*) FROM audit_logs
  WHERE action = 'product.production_rounding_step_set'
    AND entity_id = current_setting('s309.bun')::uuid
    AND actor_id = (SELECT id FROM user_profiles WHERE auth_user_id = current_setting('s309.owner')::uuid)),
  3::bigint, 'Each change is audited under the owner profile');

-- Un compte sans products.update ne règle rien. Garde lisible si les données
-- de la base ne portent aucun tel compte.
INSERT INTO s309_results(tap) SELECT isnt(NULLIF(current_setting('s309.cashier', true), ''), NULL,
  'Fixture: an active account without products.update exists');
SELECT pg_temp.authenticate_pin(current_setting('s309.cashier')::uuid);
SET LOCAL ROLE authenticated;
INSERT INTO s309_results(tap) SELECT throws_ok(
  format('SELECT public.set_production_rounding_step_v1(%L, 12)', current_setting('s309.bun')),
  '42501', 'permission_denied', 'An account without products.update cannot set the step');
RESET ROLE;

SELECT tap FROM s309_results ORDER BY n;
SELECT * FROM finish();
ROLLBACK;
