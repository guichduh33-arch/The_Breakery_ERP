-- Session 35 — F-003 (Wave C corrective): relax session_id requirement for held orders.
-- Held orders (is_held=true) are session-independent draft snapshots created via the
-- POS (created_via='pos') with no open-shift binding; they are always DELETEd on
-- restore/discard, never transitioned to a paid sale. Exempt them from the session_id
-- requirement (mirrors the existing 'tablet' / 'b2b' exemptions). Discovered via pgTAP
-- T1 hitting orders_session_id_required_for_pos.
ALTER TABLE public.orders DROP CONSTRAINT orders_session_id_required_for_pos;
ALTER TABLE public.orders ADD CONSTRAINT orders_session_id_required_for_pos
  CHECK (
    (session_id IS NOT NULL)
    OR (order_type = 'b2b'::order_type)
    OR (created_via = 'tablet'::text)
    OR (is_held = true)
  );
