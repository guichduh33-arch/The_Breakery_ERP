-- Les trois rapports financiers signalés et le calcul PB1 sont réservés à l'Owner.
-- Repartir du corps réellement installé conserve les correctifs propres à la cible.
DO $migration$
DECLARE
  v_old text;
  v_new text;
  v_args text;
  v_body text;
  v_signature regprocedure;
BEGIN
  FOR v_old, v_new, v_args IN
    SELECT * FROM (VALUES
      ('calculate_pb1_payable_v4', 'calculate_pb1_payable_v5', 'date,date'),
      ('get_gross_margin_by_product_v4', 'get_gross_margin_by_product_v5', 'text,text,uuid'),
      ('get_payments_by_method_v4', 'get_payments_by_method_v5', 'text,text'),
      ('get_pb1_report_v5', 'get_pb1_report_v6', 'integer,integer')
    ) AS rpc(old_name,new_name,args)
  LOOP
    v_signature := to_regprocedure(format('public.%I(%s)',v_old,v_args));
    IF v_signature IS NULL THEN
      RAISE EXCEPTION 'Missing financial report RPC: %',v_old;
    END IF;
    v_body := pg_get_functiondef(v_signature);
    v_body := replace(v_body,format('public.%I(',v_old),format('public.%I(',v_new));
    IF v_body !~ E'BEGIN\\s' THEN
      RAISE EXCEPTION 'Unexpected financial report body: %',v_old;
    END IF;
    v_body := regexp_replace(v_body,E'BEGIN\\s',E'BEGIN\n'
      '  IF NOT public.is_business_owner_v1() THEN\n'
      '    RAISE EXCEPTION ''financial_reports_owner_required'' USING ERRCODE=''42501'';\n'
      '  END IF;\n');
    IF v_old='get_pb1_report_v5' THEN
      v_body := replace(v_body,'calculate_pb1_payable_v4(','calculate_pb1_payable_v5(');
    END IF;
    EXECUTE v_body;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated',v_new,v_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated,service_role',v_new,v_args);
  END LOOP;
  -- Supprimer d'abord l'appelant PB1, puis son calcul, sans CASCADE.
  DROP FUNCTION public.get_pb1_report_v5(integer,integer);
  DROP FUNCTION public.calculate_pb1_payable_v4(date,date);
  DROP FUNCTION public.get_gross_margin_by_product_v4(text,text,uuid);
  DROP FUNCTION public.get_payments_by_method_v4(text,text);
END $migration$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
