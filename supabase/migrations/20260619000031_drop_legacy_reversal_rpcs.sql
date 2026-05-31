-- 20260619000031_drop_legacy_reversal_rpcs.sql
-- Security hardening FINALIZER (security-fraud-guard gap 1, Pattern #4).
--
-- The Edge Functions void-order / cancel-item / refund-order have been redeployed
-- to call the service_role-only v-next RPCs (void_order_rpc_v2,
-- cancel_order_item_rpc_v2, refund_order_rpc_v3 — migration 20260619000030).
-- The legacy reversal RPCs are now unused AND still GRANT EXECUTE TO authenticated,
-- which is exactly the bypass vector: a cashier could call them directly via
-- PostgREST with no manager PIN. Drop them.
--
-- ⚠️ APPLY ONLY AFTER the three EFs are redeployed (done: void-order v7,
-- cancel-item v7, refund-order v8 — ACTIVE on V3 dev). Dropping them before the
-- redeploy would break live refund/void/cancel.

DROP FUNCTION IF EXISTS public.void_order_rpc(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.cancel_order_item_rpc(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.refund_order_rpc_v2(UUID, JSONB, JSONB, TEXT, UUID, UUID);
-- Original v1 refund (pre-idempotency, S10) — drop too if still present.
DROP FUNCTION IF EXISTS public.refund_order_rpc(UUID, JSONB, JSONB, TEXT, UUID);
