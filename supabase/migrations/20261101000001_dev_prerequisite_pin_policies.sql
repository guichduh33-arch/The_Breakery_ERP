-- Défense PIN commune aux tables créées par les lots antifraude/inter-shifts.
-- Aucun droit ni policy permissive ajouté : les tables restent privées.
CREATE POLICY pin_session_required ON public.business_day_releases
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.request_has_active_pin_session_v1()))
WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));

CREATE POLICY pin_session_required ON public.business_day_visibility_config
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.request_has_active_pin_session_v1()))
WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));

CREATE POLICY pin_session_required ON public.pos_payment_attempt_keys
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.request_has_active_pin_session_v1()))
WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));

CREATE POLICY pin_session_required ON public.stock_declarations
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.request_has_active_pin_session_v1()))
WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));
