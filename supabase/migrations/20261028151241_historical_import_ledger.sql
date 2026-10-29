-- Reprise financiere distincte de l'ancien historique sans ecriture comptable.
CREATE TABLE public.historical_import_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_key uuid NOT NULL UNIQUE,
 source_system text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sales','purchases')),
 batch_reference text NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 preview_hash text NOT NULL CHECK(preview_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 status text NOT NULL CHECK(status IN ('applying','applied')),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 backend_pid integer NOT NULL DEFAULT pg_backend_pid(),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_system,kind,batch_reference)
);
CREATE TABLE public.historical_import_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES public.historical_import_runs(id),
 source_system text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sales','purchases')),
 source_reference text NOT NULL,
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 source_payload jsonb NOT NULL,
 entity_id uuid NOT NULL UNIQUE,
 document_date date NOT NULL,
 effective_at timestamptz NOT NULL,
 time_precision text NOT NULL CHECK(time_precision IN ('day','timestamp')),
 receipt_date date,
 counterparty_id uuid,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 total_amount numeric(14,2) NOT NULL CHECK(total_amount>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_system,kind,source_reference)
);
CREATE TABLE public.historical_import_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES public.historical_import_runs(id),
 source_system text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sales','purchases')),
 source_reference text NOT NULL,
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 source_payload jsonb NOT NULL,
 payment_date date NOT NULL,
 effective_at timestamptz NOT NULL,
 time_precision text NOT NULL CHECK(time_precision IN ('day','timestamp')),
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 method public.payment_method NOT NULL CHECK(method<>'store_credit'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_system,kind,source_reference)
);
CREATE TABLE public.historical_import_allocations (
 payment_id uuid NOT NULL REFERENCES public.historical_import_payments(id),
 document_id uuid NOT NULL REFERENCES public.historical_import_documents(id),
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 native_payment_id uuid NOT NULL,
 journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id),
 PRIMARY KEY(payment_id,document_id)
);
CREATE TABLE public.historical_import_stock_effects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES public.historical_import_runs(id),
 document_id uuid NOT NULL REFERENCES public.historical_import_documents(id),
 product_id uuid NOT NULL REFERENCES public.products(id),
 movement_type public.movement_type NOT NULL CHECK(movement_type IN ('sale','purchase')),
 quantity numeric NOT NULL CHECK(quantity<>0),
 unit text NOT NULL,
 unit_cost numeric CHECK(unit_cost>=0),
 acquisition_amount numeric(14,2),
 unit_cost_representation_delta numeric(14,2),
 source_line_reference text,
 effective_date date NOT NULL,
 effective_at timestamptz NOT NULL,
 time_precision text NOT NULL CHECK(time_precision IN ('day','timestamp')),
 reference_type text NOT NULL,
 reference_id uuid NOT NULL,
 consumed boolean NOT NULL DEFAULT false,
 movement_id uuid UNIQUE REFERENCES public.stock_movements(id) DEFERRABLE INITIALLY DEFERRED,
 display_movement_id uuid UNIQUE REFERENCES public.display_movements(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX historical_import_stock_effects_pending ON public.historical_import_stock_effects(run_id,product_id) WHERE NOT consumed;
ALTER TABLE public.orders ADD COLUMN financial_import_document_id uuid UNIQUE REFERENCES public.historical_import_documents(id);
ALTER TABLE public.purchase_orders ADD COLUMN financial_import_document_id uuid UNIQUE REFERENCES public.historical_import_documents(id);
ALTER TABLE public.orders DROP CONSTRAINT orders_session_id_required_for_pos;
ALTER TABLE public.orders ADD CONSTRAINT orders_session_id_required_for_pos CHECK(
 session_id IS NOT NULL OR order_type='b2b' OR created_via='tablet' OR is_held=true
 OR is_historical_import=true OR financial_import_document_id IS NOT NULL
);
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['historical_import_runs','historical_import_documents','historical_import_payments',
  'historical_import_allocations','historical_import_stock_effects'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('CREATE POLICY pin_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()))',t);
 END LOOP;
END $$;

CREATE FUNCTION public._historical_import_hash_v1(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,extensions,pg_temp AS $$
 SELECT encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;
CREATE FUNCTION public._historical_import_actor_v1(p_kind text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid; v_permission text; v_permissions text[];
BEGIN
 IF NOT request_has_active_pin_session_v1() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'active_pin_session_required' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id=auth.uid()
  AND deleted_at IS NULL AND is_active AND role_code='SUPER_ADMIN';
 IF v_actor IS NULL OR p_kind IS NULL OR p_kind NOT IN ('sales','purchases') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 v_permissions:=ARRAY['accounting.je.create_manual']||CASE WHEN p_kind='sales' THEN ARRAY['pos.sale.create']
  ELSE ARRAY['purchasing.po.create','purchasing.po.receive','purchasing.po.pay'] END;
 FOREACH v_permission IN ARRAY v_permissions LOOP
  IF NOT has_permission(auth.uid(),v_permission) OR NOT EXISTS (
   SELECT 1 FROM user_sessions WHERE id=(auth.jwt()->>'session_id')::uuid
    AND v_permission=ANY(permissions_snapshot)) THEN
   RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
  END IF;
 END LOOP;
 RETURN v_actor;
END $$;
-- Le GUC n'est qu'un pointeur : seul un run prive de CETTE transaction fait autorite.
CREATE FUNCTION public._historical_import_context_v1()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_run uuid; v_text text:=current_setting('breakery.historical_import_run',true);
BEGIN
 IF coalesce(v_text,'') !~ '^[a-f0-9-]{36}$' THEN RETURN NULL; END IF;
 SELECT r.id INTO v_run FROM historical_import_runs r JOIN user_profiles p ON p.id=r.actor_id
 WHERE r.id=v_text::uuid AND r.status='applying' AND r.transaction_id=txid_current()
  AND r.backend_pid=pg_backend_pid() AND p.auth_user_id=auth.uid()
  AND p.deleted_at IS NULL AND p.is_active AND p.role_code='SUPER_ADMIN'
  AND request_has_active_pin_session_v1();
 RETURN v_run;
END $$;
CREATE FUNCTION public._historical_import_stock_stamp_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_run uuid:=_historical_import_context_v1(); v_effect historical_import_stock_effects%ROWTYPE;
BEGIN
 IF v_run IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO v_effect FROM historical_import_stock_effects e
 WHERE e.run_id=v_run AND NOT e.consumed AND e.product_id=NEW.product_id
  AND e.movement_type=NEW.movement_type AND e.quantity=NEW.quantity AND e.unit=NEW.unit
  AND e.reference_type=NEW.reference_type AND e.reference_id=NEW.reference_id
  AND e.unit_cost IS NOT DISTINCT FROM NEW.unit_cost
 ORDER BY e.id LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR NEW.created_by IS DISTINCT FROM (SELECT actor_id FROM historical_import_runs WHERE id=v_run) THEN
  RAISE EXCEPTION 'historical_stock_effect_not_planned' USING ERRCODE='P0002';
 END IF;
 NEW.created_at:=v_effect.effective_at;
 NEW.metadata:=NEW.metadata||jsonb_build_object('financial_import_run_id',v_run,'financial_import_document_id',v_effect.document_id,
  'source_date_precision',v_effect.time_precision,'acquisition_amount',v_effect.acquisition_amount,
  'unit_cost_representation_delta',v_effect.unit_cost_representation_delta,'source_line_reference',v_effect.source_line_reference);
 UPDATE historical_import_stock_effects SET consumed=true,movement_id=NEW.id WHERE id=v_effect.id;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_import_stock_stamp BEFORE INSERT ON public.stock_movements
 FOR EACH ROW EXECUTE FUNCTION public._historical_import_stock_stamp_v1();

-- Le helper canonique ajoute ensuite le miroir vitrine ; l'effet deja consomme
-- par le stock global autorise exactement UN append date, jamais une retouche.
CREATE FUNCTION public._historical_import_display_stamp_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_run uuid:=_historical_import_context_v1(); v_effect historical_import_stock_effects%ROWTYPE;
BEGIN
 IF v_run IS NULL THEN RETURN NEW; END IF;
 SELECT e.* INTO v_effect FROM historical_import_stock_effects e
 JOIN stock_movements s ON s.id=e.movement_id
 JOIN products p ON p.id=e.product_id AND p.is_display_item
 WHERE e.run_id=v_run AND e.consumed AND e.display_movement_id IS NULL
  AND e.product_id=NEW.product_id AND e.movement_type::text=NEW.movement_type::text
  AND e.movement_type='sale' AND e.quantity=NEW.quantity AND e.reference_id=NEW.reference_id
  AND e.reference_type='orders' AND NEW.reference_type='order'
  AND s.product_id=e.product_id AND s.quantity=e.quantity AND s.reference_id=e.reference_id
 ORDER BY e.id LIMIT 1 FOR UPDATE OF e;
 IF NOT FOUND OR NEW.created_by IS DISTINCT FROM (SELECT actor_id FROM historical_import_runs WHERE id=v_run) THEN
  RAISE EXCEPTION 'historical_display_effect_not_planned' USING ERRCODE='P0002';
 END IF;
 NEW.created_at:=v_effect.effective_at;
 UPDATE historical_import_stock_effects SET display_movement_id=NEW.id WHERE id=v_effect.id;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_import_display_stamp BEFORE INSERT ON public.display_movements
 FOR EACH ROW EXECUTE FUNCTION public._historical_import_display_stamp_v1();

REVOKE ALL ON FUNCTION public._historical_import_hash_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_actor_v1(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_context_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_stock_stamp_v1() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_display_stamp_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
