-- Défense en profondeur commune à toutes les tables publiques avec RLS.
-- Aucun grant ni policy permissive : les accès restent réservés aux RPC protégées.
CREATE POLICY pin_session_required ON public.stock_declarations
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.request_has_active_pin_session_v1())
 WITH CHECK (public.request_has_active_pin_session_v1());
CREATE POLICY pin_session_required ON public.business_day_visibility_config
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.request_has_active_pin_session_v1())
 WITH CHECK (public.request_has_active_pin_session_v1());
CREATE POLICY pin_session_required ON public.business_day_releases
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.request_has_active_pin_session_v1())
 WITH CHECK (public.request_has_active_pin_session_v1());
