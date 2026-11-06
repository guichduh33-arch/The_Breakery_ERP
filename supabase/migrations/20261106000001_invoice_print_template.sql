-- Modèle B2B structuré : présentation et format papier, sans données financières.
CREATE TYPE public.invoice_print_density AS ENUM ('comfortable','compact');
CREATE TABLE public.invoice_print_templates (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 heading text NOT NULL DEFAULT 'INVOICE' CHECK(length(heading) BETWEEN 1 AND 60),
 business_name text NOT NULL DEFAULT '' CHECK(length(business_name)<=100),
 contact_text text NOT NULL DEFAULT '' CHECK(length(contact_text)<=500),
 payment_instructions text NOT NULL DEFAULT '' CHECK(length(payment_instructions)<=1000),
 footer_message text NOT NULL DEFAULT 'Thank you for choosing The Breakery.' CHECK(length(footer_message)<=500),
 show_logo boolean NOT NULL DEFAULT true,
 show_contact boolean NOT NULL DEFAULT true,
 show_unit_prices boolean NOT NULL DEFAULT true,
 show_due_date boolean NOT NULL DEFAULT true,
 density public.invoice_print_density NOT NULL DEFAULT 'comfortable',
 paper_width_mm numeric(7,2) NOT NULL DEFAULT 210 CHECK(paper_width_mm BETWEEN 100 AND 420),
 paper_height_mm numeric(7,2) NOT NULL DEFAULT 297 CHECK(paper_height_mm BETWEEN 100 AND 594),
 margin_left_mm numeric(6,2) NOT NULL DEFAULT 12 CHECK(margin_left_mm BETWEEN 0 AND 50),
 margin_right_mm numeric(6,2) NOT NULL DEFAULT 12 CHECK(margin_right_mm BETWEEN 0 AND 50),
 margin_top_mm numeric(6,2) NOT NULL DEFAULT 12 CHECK(margin_top_mm BETWEEN 0 AND 50),
 margin_bottom_mm numeric(6,2) NOT NULL DEFAULT 12 CHECK(margin_bottom_mm BETWEEN 0 AND 50),
 offset_x_mm numeric(6,2) NOT NULL DEFAULT 0 CHECK(offset_x_mm BETWEEN -20 AND 20),
 offset_y_mm numeric(6,2) NOT NULL DEFAULT 0 CHECK(offset_y_mm BETWEEN -20 AND 20),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES public.user_profiles(id),
 CONSTRAINT invoice_print_area CHECK(
  paper_width_mm-margin_left_mm-margin_right_mm>=80
  AND paper_height_mm-margin_top_mm-margin_bottom_mm>=75
  AND margin_left_mm+offset_x_mm>=0 AND margin_right_mm-offset_x_mm>=0
  AND margin_top_mm+offset_y_mm>=0 AND margin_bottom_mm-offset_y_mm>=0)
);
INSERT INTO public.invoice_print_templates(id) VALUES(true);
ALTER TABLE public.invoice_print_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_print_templates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.invoice_print_templates TO service_role;
CREATE POLICY invoice_template_service_read ON public.invoice_print_templates FOR SELECT TO service_role USING(true);

CREATE FUNCTION public.get_invoice_print_template_v1()
RETURNS public.invoice_print_templates LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.invoice_print_templates;
BEGIN
 IF auth.uid() IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT public.has_permission(auth.uid(),'settings.read') THEN
  RAISE EXCEPTION 'permission_denied: settings.read' USING ERRCODE='P0003';
 END IF;
 SELECT * INTO STRICT v_row FROM public.invoice_print_templates WHERE id;
 RETURN v_row;
END $$;

CREATE FUNCTION public.update_invoice_print_template_v1(p_settings jsonb,p_expected_revision integer)
RETURNS public.invoice_print_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old public.invoice_print_templates; v_new public.invoice_print_templates;
 v_key text; v_value jsonb; v_actor uuid; v_before jsonb; v_after jsonb;
 v_text text[]:=ARRAY['heading','business_name','contact_text','payment_instructions','footer_message','density'];
 v_bool text[]:=ARRAY['show_logo','show_contact','show_unit_prices','show_due_date'];
 v_number text[]:=ARRAY['paper_width_mm','paper_height_mm','margin_left_mm','margin_right_mm','margin_top_mm','margin_bottom_mm','offset_x_mm','offset_y_mm'];
BEGIN
 IF auth.uid() IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT public.has_permission(auth.uid(),'settings.update') THEN
  RAISE EXCEPTION 'permission_denied: settings.update' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_actor FROM public.user_profiles
  WHERE auth_user_id=auth.uid() AND deleted_at IS NULL AND is_active;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'active_profile_required' USING ERRCODE='P0003'; END IF;
 IF p_settings IS NULL OR jsonb_typeof(p_settings)<>'object' OR p_settings='{}'::jsonb THEN
  RAISE EXCEPTION 'invalid_invoice_template' USING ERRCODE='22023'; END IF;
 FOR v_key,v_value IN SELECT * FROM jsonb_each(p_settings) LOOP
  IF NOT(v_key=ANY(v_text||v_bool||v_number)) OR v_value='null'::jsonb
   OR (v_key=ANY(v_text) AND jsonb_typeof(v_value)<>'string')
   OR (v_key=ANY(v_bool) AND jsonb_typeof(v_value)<>'boolean')
   OR (v_key=ANY(v_number) AND jsonb_typeof(v_value)<>'number') THEN
   RAISE EXCEPTION 'invalid_invoice_template_field: %',v_key USING ERRCODE='22023';
  END IF;
 END LOOP;
 SELECT * INTO STRICT v_old FROM public.invoice_print_templates WHERE id FOR UPDATE;
 v_before:=to_jsonb(v_old)-ARRAY['id','revision','updated_at','updated_by'];
 SELECT * INTO v_new FROM jsonb_populate_record(v_old,p_settings);
 v_after:=to_jsonb(v_new)-ARRAY['id','revision','updated_at','updated_by'];
 -- Rejouer la même présentation ne crée ni révision ni audit supplémentaire.
 IF v_before=v_after THEN RETURN v_old; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision<>v_old.revision THEN
  RAISE EXCEPTION 'invoice_template_changed_reload' USING ERRCODE='40001'; END IF;
 UPDATE public.invoice_print_templates SET
  heading=v_new.heading,business_name=v_new.business_name,contact_text=v_new.contact_text,
  payment_instructions=v_new.payment_instructions,footer_message=v_new.footer_message,
  show_logo=v_new.show_logo,show_contact=v_new.show_contact,show_unit_prices=v_new.show_unit_prices,
  show_due_date=v_new.show_due_date,density=v_new.density,paper_width_mm=v_new.paper_width_mm,
  paper_height_mm=v_new.paper_height_mm,margin_left_mm=v_new.margin_left_mm,margin_right_mm=v_new.margin_right_mm,
  margin_top_mm=v_new.margin_top_mm,margin_bottom_mm=v_new.margin_bottom_mm,
  offset_x_mm=v_new.offset_x_mm,offset_y_mm=v_new.offset_y_mm,
  revision=v_old.revision+1,updated_at=now(),updated_by=v_actor WHERE id RETURNING * INTO v_new;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
  VALUES(v_actor,'settings.invoice_template.updated','invoice_print_template',NULL,
   jsonb_build_object('revision',v_new.revision),jsonb_build_object('before',v_before,'after',v_after));
 RETURN v_new;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_invoice_print_template_v1() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_invoice_print_template_v1(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_invoice_print_template_v1(),public.update_invoice_print_template_v1(jsonb,integer) TO authenticated,service_role;
