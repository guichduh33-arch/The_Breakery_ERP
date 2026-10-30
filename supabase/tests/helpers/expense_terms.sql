-- Fixtures de dépenses standardisées, limitées à la transaction de test.
CREATE FUNCTION pg_temp.expense_term_fixture(p_category uuid,p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
 SELECT id INTO v_id FROM public.expense_terms WHERE category_id=p_category AND name=p_name LIMIT 1;
 IF v_id IS NULL THEN
  INSERT INTO public.expense_terms(code,name,category_id)
   VALUES('TEST-'||gen_random_uuid(),p_name,p_category) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.expense_term_fixture(uuid,text) TO authenticated,service_role;
