-- Complète les chemins métier directs dépourvus d'audit, sans journaliser les heartbeats.
CREATE FUNCTION public.audit_business_row_change_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_fields text[] := string_to_array(TG_ARGV[1], ',');
  v_action text := lower(TG_OP);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT jsonb_object_agg(key, value) INTO v_old
    FROM jsonb_each(to_jsonb(OLD)) WHERE key = ANY(v_fields);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT jsonb_object_agg(key, value) INTO v_new
    FROM jsonb_each(to_jsonb(NEW)) WHERE key = ANY(v_fields);
  END IF;
  IF TG_OP = 'UPDATE' AND v_old IS NOT DISTINCT FROM v_new THEN RETURN NEW; END IF;
  v_row := COALESCE(v_new, v_old);
  IF TG_OP = 'UPDATE' AND v_old->>'deleted_at' IS NULL AND v_new->>'deleted_at' IS NOT NULL THEN
    v_action := 'delete';
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (public.get_current_profile_id(), TG_ARGV[0] || '.' || v_action,
    TG_ARGV[0], (v_row->>'id')::uuid,
    jsonb_strip_nulls(jsonb_build_object('name', COALESCE(v_row->>'name', v_row->>'code'),
      'source', TG_TABLE_NAME)),
    jsonb_build_object('before', v_old, 'after', v_new));
  RETURN COALESCE(NEW, OLD);
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_business_row_change_v1() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_supplier_changes AFTER INSERT OR UPDATE OR DELETE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('supplier',
  'id,code,name,contact_phone,contact_email,address,payment_terms_days,notes,is_active,deleted_at');

-- La suppression possède déjà son audit dans delete_promotion.
CREATE TRIGGER audit_promotion_changes AFTER INSERT OR UPDATE ON public.promotions
FOR EACH ROW WHEN (NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.audit_business_row_change_v1('promotion',
  'id,name,slug,description,type,scope,discount_value,max_discount_amount,scope_product_ids,scope_category_ids,bogo_trigger_product_ids,bogo_reward_product_ids,bogo_trigger_qty,bogo_reward_qty,bogo_reward_discount_pct,gift_product_id,gift_qty,min_items_total,customer_category_ids,customer_tier_ids,start_at,end_at,day_of_week_mask,start_hour,end_hour,priority,stackable_with_promo,stackable_with_manual,is_active,bogo_buy_quantity,bogo_get_quantity,bogo_get_product_id,threshold_amount,threshold_type,bundle_product_ids,bundle_price,max_uses,max_uses_per_customer');

CREATE TRIGGER audit_holiday_changes AFTER INSERT OR UPDATE OR DELETE ON public.holidays
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('holiday',
  'id,name,date,type,is_recurring,notes,deleted_at');
CREATE TRIGGER audit_receipt_template_changes AFTER INSERT OR UPDATE OR DELETE ON public.receipt_templates
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('receipt_template',
  'id,name,header,footer,paper_size,show_qr,show_logo,custom_css,is_default');
CREATE TRIGGER audit_notification_template_changes AFTER INSERT OR UPDATE OR DELETE ON public.notification_templates
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('notification_template',
  'id,code,channel,subject_template,body_template,variables,is_active');
CREATE TRIGGER audit_email_template_changes AFTER INSERT OR UPDATE OR DELETE ON public.email_templates
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('email_template',
  'id,code,subject,body_html,body_text,variables,is_active');
CREATE TRIGGER audit_lan_device_changes AFTER INSERT OR UPDATE OR DELETE ON public.lan_devices
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('lan_device',
  'id,code,name,device_type,ip_address,port,location,is_active,capabilities,deleted_at');
CREATE TRIGGER audit_recipe_mode_changes AFTER UPDATE OF is_baker_percentage ON public.recipes
FOR EACH ROW WHEN (OLD.is_baker_percentage IS DISTINCT FROM NEW.is_baker_percentage)
EXECUTE FUNCTION public.audit_business_row_change_v1('recipe_mode',
  'id,product_id,material_id,is_baker_percentage,baker_percentage');
CREATE TRIGGER audit_margin_alert_acknowledgement AFTER UPDATE OF acknowledged_at, acknowledged_by, notes ON public.margin_alerts
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('margin_alert',
  'id,product_id,acknowledged_at,acknowledged_by,notes');

CREATE FUNCTION public.audit_kitchen_progress_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.prep_started_at IS NULL AND NEW.prep_started_at IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
    VALUES (public.get_current_profile_id(), 'kds.preparation_started', 'order_item', NEW.id,
      jsonb_build_object('order_id', NEW.order_id, 'name', NEW.name_snapshot),
      jsonb_build_object('before', OLD.prep_started_at, 'after', NEW.prep_started_at));
  END IF;
  IF OLD.served_at IS NULL AND NEW.served_at IS NOT NULL THEN
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
    VALUES (COALESCE(NEW.served_by, public.get_current_profile_id()), 'kds.item_served', 'order_item', NEW.id,
      jsonb_build_object('order_id', NEW.order_id, 'name', NEW.name_snapshot),
      jsonb_build_object('before', OLD.served_at, 'after', NEW.served_at));
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_kitchen_progress_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_kitchen_progress AFTER UPDATE OF prep_started_at, served_at ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.audit_kitchen_progress_v1();

CREATE FUNCTION public.audit_shift_opened_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (NEW.opened_by, 'shift.open', 'pos_session', NEW.id,
    jsonb_build_object('amount', NEW.opening_cash, 'terminal_id', NEW.terminal_id));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_shift_opened_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_shift_opened AFTER INSERT ON public.pos_sessions
FOR EACH ROW EXECUTE FUNCTION public.audit_shift_opened_v1();
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
