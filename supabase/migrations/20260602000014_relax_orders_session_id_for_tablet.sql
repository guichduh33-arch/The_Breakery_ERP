-- Session 25 — Phase 1.A.1 — _014 (corrective, discovered during Phase 2.A.1 pgTAP testing)
-- The orders_session_id_required_for_pos check (S24 `20260601000007_relax_orders_session_id_nullable.sql`)
-- relaxed `session_id IS NOT NULL` to also allow `order_type='b2b'`. But it
-- failed to account for the existing tablet flow :
--
--   1. waiter calls create_tablet_order(_v2) — status='pending_payment',
--      session_id=NULL, created_via='tablet'  ← BLOCKED by S24 constraint
--   2. cashier calls pickup_tablet_order(p_order_id, p_session_id)
--      — status='draft', session_id assigned
--   3. cashier calls pay_existing_order — status='paid', etc.
--
-- Step 1 has been silently broken since S24 shipped (Q1 found no tests exercise
-- the tablet path end-to-end against cloud — only inventory + B2B got that
-- coverage). The Phase 2.A.1 pgTAP T1 caught it.
--
-- Fix : allow NULL session_id whenever created_via='tablet'. After pickup,
-- session_id is always set by pickup_tablet_order (and the RPC enforces this
-- via its UPDATE). For voided tablet orders (cancel_tablet_order without
-- pickup), session_id legitimately remains NULL — those rows don't roll up
-- into shift accounting, so the loose form is correct.

ALTER TABLE orders DROP CONSTRAINT orders_session_id_required_for_pos;

ALTER TABLE orders ADD CONSTRAINT orders_session_id_required_for_pos
  CHECK (
    session_id IS NOT NULL
    OR order_type = 'b2b'::order_type
    OR created_via = 'tablet'
  );
