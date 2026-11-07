-- Défense PIN commune aux nouveaux relevés quotidiens, en plus des ACL fermées.
CREATE POLICY pin_session_required ON public.display_day_closings
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.request_has_active_pin_session_v1())
 WITH CHECK (public.request_has_active_pin_session_v1());
CREATE POLICY pin_session_required ON public.display_day_closing_items
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.request_has_active_pin_session_v1())
 WITH CHECK (public.request_has_active_pin_session_v1());
