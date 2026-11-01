-- Même garde PIN restrictive que les autres ledgers internes ; aucun droit client ajouté.
CREATE POLICY pin_session_required ON public.b2b_order_edit_keys
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.request_has_active_pin_session_v1()))
WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));
