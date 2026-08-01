-- supabase/tests/get_audit_logs_v3.test.sql
-- pgTAP for get_audit_logs_v3 — the entity_id-aware audit log RPC powering the
-- product detail History tab, plus the business-date window added by the
-- Reports audit of 2026-08-01 (R-10, migration 20260801000003).
--
-- Run via cloud MCP execute_sql wrapped in BEGIN ... ROLLBACK.

BEGIN;
SELECT plan(7);

-- ------------------------------------------------------------------
-- Fixtures: two distinct product ids, three audit rows.
-- ------------------------------------------------------------------
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at) VALUES
  (NULL, 's_test.product.updated', 'product', '11111111-1111-1111-1111-111111111111', '{"field":"retail_price"}', now() - interval '2 hour'),
  (NULL, 's_test.product.deleted', 'product', '11111111-1111-1111-1111-111111111111', '{}',                       now() - interval '1 hour'),
  (NULL, 's_test.product.updated', 'product', '22222222-2222-2222-2222-222222222222', '{"field":"name"}',          now());

-- T1: function exists with the 8-arg signature.
SELECT has_function(
  'public', 'get_audit_logs_v3',
  ARRAY['timestamp with time zone','integer','uuid','text','text','uuid','text','text'],
  'get_audit_logs_v3 exists with the entity_id + date-window signature'
);

-- T2: filtering by entity_id returns ONLY that product's rows.
SELECT is(
  (SELECT count(*)::int FROM public.get_audit_logs_v3(
     p_entity_type := 'product',
     p_entity_id   := '11111111-1111-1111-1111-111111111111'
   ) WHERE action LIKE 's_test.%'),
  2,
  'entity_id filter returns the 2 rows for product 1'
);

-- T3: the other product is excluded by the entity_id filter.
SELECT is(
  (SELECT count(*)::int FROM public.get_audit_logs_v3(
     p_entity_type := 'product',
     p_entity_id   := '11111111-1111-1111-1111-111111111111'
   ) WHERE entity_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'rows for a different product never leak through the entity_id filter'
);

-- T4: NULL entity_id keeps the historical behaviour (no per-entity restriction).
SELECT ok(
  (SELECT count(*)::int FROM public.get_audit_logs_v3(
     p_entity_type := 'product'
   ) WHERE action LIKE 's_test.%') >= 3,
  'NULL p_entity_id returns all product rows (backwards-compatible)'
);

-- T5: anon must NOT hold EXECUTE (REVOKE pair / defense-in-depth).
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_audit_logs_v3(timestamp with time zone,integer,uuid,text,text,uuid,text,text)',
    'EXECUTE'
  ),
  'anon cannot execute get_audit_logs_v3'
);

-- T6: une fenetre metier qui couvre aujourd'hui ramene les lignes fixtures.
-- Les 3 fixtures sont posees a now() / -1h / -2h, donc dans la journee locale.
SELECT ok(
  (SELECT count(*)::int FROM public.get_audit_logs_v3(
     p_limit      := 200,
     p_action     := 's_test.product.updated',
     p_date_start := (now() AT TIME ZONE (SELECT COALESCE(MAX(timezone), 'Asia/Makassar') FROM business_config WHERE id = 1))::date::text,
     p_date_end   := (now() AT TIME ZONE (SELECT COALESCE(MAX(timezone), 'Asia/Makassar') FROM business_config WHERE id = 1))::date::text
   )) >= 1,
  'p_date_start/p_date_end covering today returns the fixture rows'
);

-- T7: une fenetre passee lointaine n'en ramene aucune.
SELECT is(
  (SELECT count(*)::int FROM public.get_audit_logs_v3(
     p_limit      := 200,
     p_action     := 's_test.product.updated',
     p_date_start := '1999-01-01',
     p_date_end   := '1999-01-02'
   )),
  0,
  'a window outside the data returns nothing'
);

SELECT * FROM finish();
ROLLBACK;
