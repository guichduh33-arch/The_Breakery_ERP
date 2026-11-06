-- Défense PIN commune, en plus des ACL fermées et des RPC de réglages.
-- Migration séparée : le modèle initial est déjà publié sur DEV.
CREATE POLICY pin_session_required ON public.invoice_print_templates
 AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT public.request_has_active_pin_session_v1()))
 WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));
