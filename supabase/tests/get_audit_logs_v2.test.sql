-- supabase/tests/get_audit_logs_v2.test.sql
-- pgTAP for get_audit_logs_v2 — the additive entity_id-aware audit log RPC
-- powering the product detail History tab.
--
-- Run via cloud MCP execute_sql wrapped in BEGIN ... ROLLBACK.

BEGIN;
SELECT plan(5);

-- ------------------------------------------------------------------
-- Fixtures: two distinct product ids, three audit rows.
-- ------------------------------------------------------------------
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, created_at) VALUES
  (NULL, 's_test.product.updated', 'product', '11111111-1111-1111-1111-111111111111', '{"field":"retail_price"}', now() - interval '2 hour'),
  (NULL, 's_test.product.deleted', 'product', '11111111-1111-1111-1111-111111111111', '{}',                       now() - interval '1 hour'),
  (NULL, 's_test.product.updated', 'product', '22222222-2222-2222-2222-222222222222', '{"field":"name"}',          now());

-- T1: function exists with the 6-arg signature.
SELECT has_function(
  'public', 'get_audit_logs_v2',
  ARRAY['timestamp with time zone','integer','uuid','text','text','uuid'],
  'get_audit_logs_v2 exists with the entity_id-aware signature'
);

-- T2: filtering by entity_id returns ONLY that product's rows.
SELECT is(
  (SELECT count(*)::int FROM public.get_audit_logs_v2(
     p_entity_type := 'product',
     p_entity_id   := '11111111-1111-1111-1111-111111111111'
   ) WHERE action LIKE 's_test.%'),
  2,
  'entity_id filter returns the 2 rows for product 1'
);

-- T3: the other product is excluded by the entity_id filter.
SELECT is(
  (SELECT count(*)::int FROM public.get_audit_logs_v2(
     p_entity_type := 'product',
     p_entity_id   := '11111111-1111-1111-1111-111111111111'
   ) WHERE entity_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'rows for a different product never leak through the entity_id filter'
);

-- T4: NULL entity_id keeps the v1 behaviour (no per-entity restriction).
SELECT ok(
  (SELECT count(*)::int FROM public.get_audit_logs_v2(
     p_entity_type := 'product'
   ) WHERE action LIKE 's_test.%') >= 3,
  'NULL p_entity_id returns all product rows (v1-compatible)'
);

-- T5: anon must NOT hold EXECUTE (REVOKE pair / defense-in-depth).
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_audit_logs_v2(timestamp with time zone,integer,uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute get_audit_logs_v2'
);

SELECT * FROM finish();
ROLLBACK;
