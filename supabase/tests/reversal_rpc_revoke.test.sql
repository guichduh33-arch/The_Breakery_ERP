-- Regression guard for audit 2026-06-25 LOT 1 / U1.
-- The reversal RPCs (refund/void) MUST NOT be EXECUTE-able by authenticated or anon:
-- the manager PIN is enforced only in the edge function, so direct PostgREST access
-- would bypass it. They are callable by service_role only (edge fn admin client),
-- like cancel_order_item_rpc_v2. Any future *_modifier_ingredients-style bump that
-- recreates these functions MUST re-apply the revoke pair, or this test fails.
--
-- Run via MCP execute_sql (Docker retired): paste the body between BEGIN/ROLLBACK.

BEGIN;
SELECT plan(6);

SELECT is(has_function_privilege('authenticated', 'public.refund_order_rpc_v4(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'refund_order_rpc_v4 NOT executable by authenticated');
SELECT is(has_function_privilege('anon', 'public.refund_order_rpc_v4(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
          false, 'refund_order_rpc_v4 NOT executable by anon');
SELECT is(has_function_privilege('service_role', 'public.refund_order_rpc_v4(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
          true, 'refund_order_rpc_v4 executable by service_role');

SELECT is(has_function_privilege('authenticated', 'public.void_order_rpc_v3(uuid,text,uuid,uuid)', 'EXECUTE'),
          false, 'void_order_rpc_v3 NOT executable by authenticated');
SELECT is(has_function_privilege('anon', 'public.void_order_rpc_v3(uuid,text,uuid,uuid)', 'EXECUTE'),
          false, 'void_order_rpc_v3 NOT executable by anon');
SELECT is(has_function_privilege('service_role', 'public.void_order_rpc_v3(uuid,text,uuid,uuid)', 'EXECUTE'),
          true, 'void_order_rpc_v3 executable by service_role');

SELECT * FROM finish();
ROLLBACK;
