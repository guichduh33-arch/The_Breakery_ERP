-- Regression guard for audit 2026-06-25 LOT 1 / U1, refreshed S55 T7.
-- The reversal RPCs (refund/void/cancel) MUST NOT be EXECUTE-able by authenticated,
-- anon, or PUBLIC: the manager PIN is enforced only in the edge function, so direct
-- PostgREST access would bypass it. They are callable by service_role only (edge fn
-- admin client). Any future bump that recreates these functions under a NEW signature
-- starts from a FRESH ACL and MUST re-apply the full revoke pair INCLUDING
-- authenticated (default privileges only cover PUBLIC/anon — S20; see incidents
-- 20260709000010 and 20260710000084), or this test fails.
--
-- S55 T7: void_order_rpc_v3(uuid,text,uuid,uuid) was DROPped by 20260710000082 —
-- repointed to void_order_rpc_v5 (5-arg) and added cancel_order_item_rpc_v5 coverage.
--
-- Run via MCP execute_sql (Docker retired): paste the body between BEGIN/ROLLBACK.

BEGIN;
SELECT plan(11);

SELECT is(has_function_privilege('authenticated', 'public.refund_order_rpc_v6(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'refund_order_rpc_v6 NOT executable by authenticated');
SELECT is(has_function_privilege('anon', 'public.refund_order_rpc_v6(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'refund_order_rpc_v6 NOT executable by anon');
SELECT is(has_function_privilege('service_role', 'public.refund_order_rpc_v6(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
          true, 'refund_order_rpc_v6 executable by service_role');

SELECT is(has_function_privilege('authenticated', 'public.void_order_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'void_order_rpc_v5 NOT executable by authenticated');
SELECT is(has_function_privilege('anon', 'public.void_order_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'void_order_rpc_v5 NOT executable by anon');
SELECT is(has_function_privilege('public', 'public.void_order_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'void_order_rpc_v5 NOT executable by PUBLIC');
SELECT is(has_function_privilege('service_role', 'public.void_order_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          true, 'void_order_rpc_v5 executable by service_role');

SELECT is(has_function_privilege('authenticated', 'public.cancel_order_item_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'cancel_order_item_rpc_v5 NOT executable by authenticated');
SELECT is(has_function_privilege('anon', 'public.cancel_order_item_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'cancel_order_item_rpc_v5 NOT executable by anon');
SELECT is(has_function_privilege('public', 'public.cancel_order_item_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'cancel_order_item_rpc_v5 NOT executable by PUBLIC');
SELECT is(has_function_privilege('service_role', 'public.cancel_order_item_rpc_v5(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
          true, 'cancel_order_item_rpc_v5 executable by service_role');

SELECT * FROM finish();
ROLLBACK;
