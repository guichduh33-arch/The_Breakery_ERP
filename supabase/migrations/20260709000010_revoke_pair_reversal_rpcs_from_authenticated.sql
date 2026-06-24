-- Re-REVOKE EXECUTE on reversal RPCs from authenticated / anon / PUBLIC.
--
-- Regression fix (audit 2026-06-25, LOT 1 / U1):
--   The 20260620172527 (void_order_rpc_v3) and 20260620172629 (refund_order_rpc_v4)
--   *_modifier_ingredients bumps recreated the functions WITHOUT re-applying the
--   revoke pair, leaving them EXECUTE-able by `authenticated`. Because the manager
--   PIN is validated only inside the edge function (not in the RPC body), a cashier
--   could call POST /rest/v1/rpc/void_order_rpc_v3 directly via PostgREST, passing a
--   manager UUID as p_authorized_by, and void/refund a paid order WITHOUT a PIN —
--   breaking non-repudiation (the manager is logged as actor_id).
--
-- Fix: align both reversal RPCs to cancel_order_item_rpc_v2 — callable only by
--   service_role (the edge functions use the admin client). No body/signature change,
--   so no version bump is required: this is a grant change only (project revoke_pair
--   pattern). REVOKE from PUBLIC is mandatory because `authenticated` inherits EXECUTE
--   through PUBLIC membership (CLAUDE.md S20 note), in addition to its explicit grant.
--
-- Spec: docs/superpowers/specs/2026-06-25-pos-p0-hardening.md

REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v4(uuid, jsonb, jsonb, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v3(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.refund_order_rpc_v4(uuid, jsonb, jsonb, text, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_order_rpc_v3(uuid, text, uuid, uuid) TO service_role;
