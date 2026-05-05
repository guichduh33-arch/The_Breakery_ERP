-- 20260507000007_tablet_rls.sql
-- Session 5 / migration 7 : RLS additions for tablet order visibility
-- Waiter sees their own pending_payment tablet orders.
-- Cashier (payments.process) sees all pending tablet orders for inbox pickup.
-- Existing "auth_read" on orders already covers draft/paid/voided for all authenticated users;
-- this policy adds scoped visibility for the pending_payment status introduced in session 5.

CREATE POLICY "tablet_waiter_own_pending" ON orders FOR SELECT
  USING (
    is_authenticated()
    AND created_via = 'tablet'
    AND status = 'pending_payment'
    AND (
      waiter_id IN (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
      OR has_permission(auth.uid(), 'payments.process')
    )
  );
