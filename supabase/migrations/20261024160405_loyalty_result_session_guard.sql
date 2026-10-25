-- Même garde restrictive que les autres tables privées ; aucun grant client ajouté.
CREATE POLICY pin_session_required ON public.loyalty_operation_results
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.request_has_active_pin_session_v1()))
WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));
