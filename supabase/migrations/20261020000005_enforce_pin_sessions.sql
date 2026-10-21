-- À appliquer après émission et renouvellement des JWT liés à user_sessions.
-- Un signal sans données métier remplace les événements DELETE non filtrés par RLS.
CREATE TABLE public.ui_invalidation_topics (
  topic text PRIMARY KEY CHECK (topic IN ('catalog', 'settings', 'orders')),
  revision uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO public.ui_invalidation_topics(topic) VALUES ('catalog'), ('settings'), ('orders');
ALTER TABLE public.ui_invalidation_topics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ui_invalidation_topics FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ui_invalidation_topics TO authenticated;
CREATE POLICY read_private_signals ON public.ui_invalidation_topics FOR SELECT TO authenticated USING (true);

CREATE FUNCTION public.signal_ui_invalidation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.ui_invalidation_topics SET revision = gen_random_uuid() WHERE topic = TG_ARGV[0];
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.signal_ui_invalidation_v1() FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TRIGGER invalidate_catalog AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.products
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');
CREATE TRIGGER invalidate_catalog AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.categories
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('catalog');
CREATE TRIGGER invalidate_settings AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.business_config
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('settings');
CREATE TRIGGER invalidate_settings AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.receipt_templates
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('settings');
-- Les suppressions de brouillons/ligne non envoyée restent visibles par invalidation.
-- Aucun verrou de signal sur le parcours normal d'encaissement.
CREATE TRIGGER invalidate_deleted_orders AFTER DELETE OR TRUNCATE ON public.orders
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('orders');
CREATE TRIGGER invalidate_deleted_order_items AFTER DELETE OR TRUNCATE ON public.order_items
FOR EACH STATEMENT EXECUTE FUNCTION public.signal_ui_invalidation_v1('orders');
ALTER PUBLICATION supabase_realtime ADD TABLE public.ui_invalidation_topics;
ALTER PUBLICATION supabase_realtime SET (publish = 'insert, update');

DO $$
DECLARE v_table record;
BEGIN
  FOR v_table IN
    SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects')
        OR (n.nspname = 'realtime' AND c.relname = 'messages'))
  LOOP
    EXECUTE format(
      'CREATE POLICY pin_session_required ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()))',
      v_table.nspname, v_table.relname);
  END LOOP;
END;
$$;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_pin_session_v2';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
