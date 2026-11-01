-- Fixtures compatibles avec la version publique courante, sans dépendance aux chantiers dev voisins.
CREATE FUNCTION pg_temp.create_b2b_edit_fixture(p_customer_id uuid,p_items jsonb,p_notes text,p_delivery_date date,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_rpc text; v_result jsonb;
BEGIN
 SELECT proname INTO STRICT v_rpc FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname ~ '^create_b2b_order_v[0-9]+$' ORDER BY substring(proname FROM '[0-9]+$')::integer DESC LIMIT 1;
 EXECUTE format('SELECT public.%I($1,$2,$3,$4,$5)',v_rpc) INTO v_result USING p_customer_id,p_items,p_notes,p_delivery_date,p_idempotency_key;
 RETURN v_result;
END $$;
CREATE FUNCTION pg_temp.pay_b2b_edit_fixture(p_customer_id uuid,p_amount numeric,p_method public.payment_method,p_idempotency_key uuid,p_invoice_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_rpc text; v_result jsonb;
BEGIN
 SELECT proname INTO STRICT v_rpc FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname ~ '^record_b2b_payment_v[0-9]+$' ORDER BY substring(proname FROM '[0-9]+$')::integer DESC LIMIT 1;
 EXECUTE format('SELECT public.%I($1,$2,$3,p_idempotency_key=>$4,p_invoice_ids=>$5)',v_rpc)
 INTO v_result USING p_customer_id,p_amount,p_method,p_idempotency_key,p_invoice_ids;
 RETURN v_result;
END $$;
