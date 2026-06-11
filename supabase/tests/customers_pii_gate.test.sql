-- supabase/tests/customers_pii_gate.test.sql
-- S37 Wave C Task C5 (SEC-03/DB-03/DB-06) — customers POS RPCs v2 + gate PII.
-- T1-T5 valident les RPCs v2 (_017, appliquée).
-- T6 valide la policy gate (_018) : ne passe qu'APRÈS le hard cutover —
-- tant que _018 n'est pas appliquée, T6 est attendu FAIL (documenté INDEX S37).
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(6);

DO $$
DECLARE
  v_auth UUID; v_catg UUID; v_cust UUID;
BEGIN
  SELECT up.auth_user_id INTO v_auth
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_catg FROM customer_categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO customers (name, phone, customer_type, category_id)
    VALUES ('S37 PII Gate Tester', '0811223344', 'retail', v_catg)
    RETURNING id INTO v_cust;

  PERFORM set_config('breakery.v_cust', v_cust::text, true);
  PERFORM set_config('breakery.v_catg', v_catg::text, true);
END $$;

-- T1 : search_customers_v2 trouve le client et embed la catégorie
DO $$ DECLARE v_row RECORD;
BEGIN
  SELECT * INTO v_row FROM search_customers_v2('S37 PII Gate', 20) LIMIT 1;
  PERFORM set_config('breakery.t1_ok',
    (v_row.id IS NOT NULL AND v_row.category IS NOT NULL
     AND (v_row.category->>'id')::uuid = current_setting('breakery.v_catg')::uuid
     AND v_row.category ? 'points_multiplier' AND v_row.category ? 'price_modifier_type')::text, true);
END $$;
SELECT is(current_setting('breakery.t1_ok'), 'true', 'T1 search_customers_v2 embeds the full category');

-- T2 : get_customer_v2 retourne la même shape
DO $$ DECLARE v_row RECORD;
BEGIN
  SELECT * INTO v_row FROM get_customer_v2(current_setting('breakery.v_cust')::uuid);
  PERFORM set_config('breakery.t2_ok',
    (v_row.id IS NOT NULL AND v_row.category ? 'loyalty_enabled')::text, true);
END $$;
SELECT is(current_setting('breakery.t2_ok'), 'true', 'T2 get_customer_v2 embeds the category');

-- T3 : create_customer_v2 retourne la row créée (category NULL au create)
DO $$ DECLARE v_row RECORD;
BEGIN
  SELECT * INTO v_row FROM create_customer_v2('S37 Walkin', '0899887766');
  PERFORM set_config('breakery.t3_ok',
    (v_row.id IS NOT NULL AND v_row.name = 'S37 Walkin' AND v_row.category IS NULL)::text, true);
END $$;
SELECT is(current_setting('breakery.t3_ok'), 'true', 'T3 create_customer_v2 returns the created row');

-- T4 : v1 RPCs bien droppées (versioning monotone)
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE proname IN ('search_customers_v1','get_customer_v1','create_customer_v1')
      AND pronamespace = 'public'::regnamespace),
  0, 'T4 v1 customer RPCs dropped');

-- T5 : anon n'a pas EXECUTE sur les v2
SELECT is(
  has_function_privilege('anon', 'public.search_customers_v2(text, int)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.get_customer_v2(uuid)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.create_customer_v2(text, text, text, customer_type)', 'EXECUTE'),
  false, 'T5 anon cannot execute the v2 customer RPCs');

-- T6 (post-_018 SEULEMENT) : la policy SELECT exige customers.read
SELECT is(
  (SELECT pg_get_expr(polqual, polrelid) ILIKE '%customers.read%'
     FROM pg_policy WHERE polname = 'auth_read'
      AND polrelid = 'public.customers'::regclass),
  true, 'T6 customers SELECT policy gated behind customers.read (FAILS until _018 applied — expected)');

SELECT * FROM finish();
ROLLBACK;
