-- Visibilité indépendante : stock Owner, ventes par journée et cash par shift.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

INSERT INTO public.permissions(code,module,action,description) VALUES
 ('b2b.order.create','b2b','order.create','Create and maintain B2B orders without POS sale access'),
 ('display.count','display','count','Submit daily display leftovers and waste for Owner review')
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
SELECT DISTINCT role_code,'b2b.order.create',true FROM public.role_permissions
WHERE (permission_code='pos.sale.create' AND is_granted) OR role_code IN('SUPER_ADMIN','ADMIN')
ON CONFLICT(role_code,permission_code) DO NOTHING;
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
SELECT 'ADMIN',code,true FROM public.permissions
WHERE code IN('reports.read','reports.sales.read','reports.product_sales.read','reports.financial.read','reports.export')
ON CONFLICT(role_code,permission_code) DO NOTHING;
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
SELECT DISTINCT role_code,'display.count',true FROM public.role_permissions
WHERE (permission_code IN('pos.session.close_own','pos.session.close_other') AND is_granted)
 OR role_code IN('SUPER_ADMIN','ADMIN')
ON CONFLICT(role_code,permission_code) DO NOTHING;

CREATE FUNCTION public.can_view_stock_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_business_owner_v1()
$$;
REVOKE ALL ON FUNCTION public.can_view_stock_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_stock_v1() TO authenticated,service_role;

CREATE FUNCTION public.assert_stock_owner_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.can_view_stock_v1() THEN
  RAISE EXCEPTION 'stock_visibility_owner_required' USING ERRCODE='P0003';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_stock_owner_v1() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.can_view_sales_day_v1(p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND (
  public.is_business_owner_v1() OR (
   p_day IS NOT NULL AND p_day<=current_date
   AND NOT EXISTS(SELECT 1 FROM public.pos_sessions s
    WHERE s.opened_at::date<=p_day AND (s.status<>'closed' OR s.closed_at IS NULL))
   AND (p_day<current_date OR EXISTS(SELECT 1 FROM public.pos_sessions s
    WHERE s.status='closed' AND s.closed_at IS NOT NULL
     AND s.opened_at::date<=p_day AND s.closed_at::date>=p_day))
  ))
$$;
REVOKE ALL ON FUNCTION public.can_view_sales_day_v1(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_sales_day_v1(date) TO authenticated,service_role;

CREATE FUNCTION public.can_view_financial_shift_v1(p_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND (public.is_business_owner_v1()
  OR EXISTS(SELECT 1 FROM public.pos_sessions s WHERE s.id=p_session_id
   AND s.status='closed' AND s.closed_at IS NOT NULL))
$$;
REVOKE ALL ON FUNCTION public.can_view_financial_shift_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_financial_shift_v1(uuid) TO authenticated,service_role;

CREATE FUNCTION public.can_view_financial_entry_v1(p_entry_id uuid,p_detail boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_entry public.journal_entries%ROWTYPE; v_session uuid; v_order public.orders%ROWTYPE;
 v_attempt public.pos_payment_attempt_keys%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RETURN false; END IF;
 IF public.is_business_owner_v1() THEN RETURN true; END IF;
 SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Les écarts/opnames et les lignes de valorisation ne sont pas des détails ADMIN.
 IF p_detail AND (v_entry.reference_type IN('stock_movement','inventory_count','opname')
  OR EXISTS(SELECT 1 FROM public.journal_entry_lines l JOIN public.accounts a ON a.id=l.account_id
   WHERE l.journal_entry_id=p_entry_id AND a.code LIKE '114%')) THEN RETURN false; END IF;
 IF v_entry.reference_type IN('sale','sale_void') THEN
  SELECT * INTO v_order FROM public.orders WHERE id=v_entry.reference_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.order_type='b2b' THEN RETURN true; END IF;
  -- La reconnaissance initiale suit son shift, les encaissements ultérieurs leur JE dédiée.
  v_session:=v_order.session_id;
  IF v_entry.reference_type='sale_void' THEN
   SELECT coalesce(r.payment_session_id,r.session_id) INTO v_session
   FROM public.refunds r WHERE r.order_id=v_order.id AND r.is_full_void
   ORDER BY r.created_at DESC LIMIT 1;
   v_session:=coalesce(v_session,v_order.session_id);
  END IF;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type IN('sale_refund','refund') THEN
  SELECT coalesce(payment_session_id,session_id) INTO v_session
  FROM public.refunds WHERE id=v_entry.reference_id;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type='pos_outstanding_payment' THEN
  SELECT * INTO v_attempt FROM public.pos_payment_attempt_keys WHERE key=v_entry.reference_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_attempt.request->>'operation'='settle' AND v_attempt.request->>'session' IS NULL THEN
   RETURN true;
  END IF;
  v_session:=coalesce(nullif(v_attempt.request->>'session','')::uuid,
   nullif(v_attempt.request->>'session_id','')::uuid,
   (SELECT session_id FROM public.orders WHERE id=v_attempt.order_id));
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type IN('outstanding_payment','pos_receipt','sale_receipt','sale_payment') THEN
  v_session:=nullif(v_entry.metadata->>'session_id','')::uuid;
  IF v_session IS NULL THEN
   SELECT p.session_id INTO v_session FROM public.order_payments p
   WHERE p.id=v_entry.reference_id;
  END IF;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type='cash_movement' THEN
  IF v_entry.metadata->>'session_id' IS NOT NULL THEN
   RETURN public.can_view_financial_shift_v1((v_entry.metadata->>'session_id')::uuid);
  END IF;
  SELECT session_id INTO v_session FROM public.cash_movements WHERE id=v_entry.reference_id;
  -- Les mouvements de coffres hors POS ont une idempotence dédiée.
  IF NOT FOUND THEN RETURN EXISTS(SELECT 1 FROM public.cash_movement_idempotency_keys k
   WHERE k.je_id=p_entry_id); END IF;
  RETURN public.can_view_financial_shift_v1(v_session);
 ELSIF v_entry.reference_type IN('shift_close','shift_variance','pos_session') THEN
  RETURN public.can_view_financial_shift_v1(v_entry.reference_id);
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.can_view_financial_entry_v1(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_financial_entry_v1(uuid,boolean) TO authenticated,service_role;

-- Ces vues sont privées. Les RPC gardent leurs permissions et utilisent un périmètre commun.
CREATE VIEW reporting_private.closed_shift_journal_entries_v1 AS
 SELECT * FROM public.journal_entries j WHERE public.can_view_financial_entry_v1(j.id,false);
CREATE VIEW reporting_private.closed_shift_journal_lines_v1 AS
 SELECT l.* FROM public.journal_entry_lines l
 JOIN reporting_private.closed_shift_journal_entries_v1 j ON j.id=l.journal_entry_id;
CREATE VIEW reporting_private.safe_detail_journal_entries_v1 AS
 SELECT * FROM public.journal_entries j WHERE public.can_view_financial_entry_v1(j.id,true);
CREATE VIEW reporting_private.safe_detail_journal_lines_v1 AS
 SELECT l.* FROM public.journal_entry_lines l
 JOIN reporting_private.safe_detail_journal_entries_v1 j ON j.id=l.journal_entry_id;
CREATE VIEW reporting_private.closed_pos_orders_v1 AS
 SELECT * FROM public.orders o WHERE o.order_type='b2b'
 OR public.can_view_sales_day_v1(coalesce(o.outstanding_at,o.paid_at,o.created_at)::date);
CREATE VIEW reporting_private.closed_order_items_v1 AS
 SELECT i.* FROM public.order_items i JOIN reporting_private.closed_pos_orders_v1 o ON o.id=i.order_id;
CREATE VIEW reporting_private.closed_order_payments_v1 AS
 SELECT p.* FROM public.order_payments p JOIN public.orders o ON o.id=p.order_id
 WHERE o.order_type='b2b' OR (public.can_view_financial_shift_v1(p.session_id)
 AND public.can_view_sales_day_v1(p.paid_at::date));
CREATE VIEW reporting_private.closed_pos_sessions_v1 AS
 SELECT * FROM public.pos_sessions s WHERE public.can_view_financial_shift_v1(s.id);
CREATE VIEW reporting_private.closed_cash_movements_v1 AS
 SELECT * FROM public.cash_movements m WHERE public.can_view_financial_shift_v1(m.session_id);
CREATE VIEW reporting_private.closed_refunds_v1 AS
 SELECT r.* FROM public.refunds r WHERE public.can_view_financial_shift_v1(coalesce(r.payment_session_id,r.session_id))
 AND public.can_view_sales_day_v1(r.created_at::date);
REVOKE ALL ON reporting_private.closed_shift_journal_entries_v1,
 reporting_private.closed_shift_journal_lines_v1,reporting_private.safe_detail_journal_entries_v1,
 reporting_private.safe_detail_journal_lines_v1,reporting_private.closed_pos_orders_v1,
 reporting_private.closed_order_items_v1,reporting_private.closed_order_payments_v1,
 reporting_private.closed_pos_sessions_v1,reporting_private.closed_cash_movements_v1,
 reporting_private.closed_refunds_v1 FROM PUBLIC,anon,authenticated;

CREATE POLICY confidentiality_financial_entries ON public.journal_entries
 AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_view_financial_entry_v1(id,true));
CREATE POLICY confidentiality_financial_lines ON public.journal_entry_lines
 AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_view_financial_entry_v1(journal_entry_id,true));
CREATE POLICY confidentiality_order_payments ON public.order_payments
 AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_view_financial_shift_v1(session_id));
CREATE POLICY confidentiality_cash_movements ON public.cash_movements
 AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_view_financial_shift_v1(session_id));
