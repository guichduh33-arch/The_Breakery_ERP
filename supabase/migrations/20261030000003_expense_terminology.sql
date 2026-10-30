-- Référentiel de libellés opérationnels ; aucune réécriture des dépenses historiques.
CREATE TABLE public.expense_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL UNIQUE CHECK (code = trim(code) AND length(code) BETWEEN 1 AND 64),
 name text NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 120),
 category_id uuid NOT NULL REFERENCES public.expense_categories(id),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Le nom canonique ET les synonymes partagent un espace de noms unique.
CREATE TABLE public.expense_term_labels (
 label_key text PRIMARY KEY,
 term_id uuid NOT NULL REFERENCES public.expense_terms(id),
 label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
 CHECK (label_key = lower(regexp_replace(trim(label), '\s+', ' ', 'g')))
);
CREATE INDEX expense_term_labels_term ON public.expense_term_labels(term_id);
ALTER TABLE public.expense_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_term_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY pin_session_required ON public.expense_terms AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));
CREATE POLICY pin_session_required ON public.expense_term_labels AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()));
REVOKE ALL ON public.expense_terms, public.expense_term_labels FROM PUBLIC, anon, authenticated;

ALTER TABLE public.expenses
 ADD COLUMN expense_term_id uuid REFERENCES public.expense_terms(id),
 ADD COLUMN remarks text CHECK (length(remarks) <= 2000);
CREATE INDEX expenses_term ON public.expenses(expense_term_id);

CREATE FUNCTION public.get_expense_terms_v1(p_include_inactive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT (has_permission(auth.uid(),'expenses.read')
   OR has_permission(auth.uid(),'expenses.create') OR has_permission(auth.uid(),'expenses.manage')
   OR has_permission(auth.uid(),'expenses.categories.manage')) THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',t.id,'code',t.code,'name',t.name,'category_id',t.category_id,'category_name',c.name,
  'account_code',a.code,'account_name',a.name,'is_active',t.is_active,
  'is_available',t.is_active AND c.is_active AND a.is_active AND a.is_postable AND a.deleted_at IS NULL,
  'is_used',EXISTS(SELECT 1 FROM expenses e WHERE e.expense_term_id=t.id),
  'aliases',(SELECT coalesce(jsonb_agg(l.label ORDER BY l.label),'[]'::jsonb)
    FROM expense_term_labels l WHERE l.term_id=t.id AND l.label <> t.name)
 ) ORDER BY t.name,t.id),'[]'::jsonb)
 FROM expense_terms t JOIN expense_categories c ON c.id=t.category_id JOIN accounts a ON a.id=c.account_id
 WHERE p_include_inactive OR (t.is_active AND c.is_active AND a.is_active AND a.is_postable AND a.deleted_at IS NULL));
END $$;

CREATE FUNCTION public.save_expense_term_v1(p_code text,p_name text,p_category_id uuid,
 p_aliases text[] DEFAULT '{}',p_is_active boolean DEFAULT true,p_term_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor uuid; v_id uuid; v_before expense_terms%ROWTYPE; v_after jsonb; v_alias text;
BEGIN
 IF auth.uid() IS NULL OR NOT has_permission(auth.uid(),'expenses.categories.manage') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'profile_required' USING ERRCODE='28000'; END IF;
 IF p_code IS NULL OR length(trim(p_code)) NOT BETWEEN 1 AND 64
   OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120
   OR p_is_active IS NULL OR p_aliases IS NULL OR cardinality(p_aliases)>50 THEN
  RAISE EXCEPTION 'expense_term_invalid_fields' USING ERRCODE='22023';
 END IF;
 FOREACH v_alias IN ARRAY p_aliases LOOP
  IF v_alias IS NULL OR length(trim(v_alias)) NOT BETWEEN 1 AND 120 THEN
   RAISE EXCEPTION 'expense_term_invalid_alias' USING ERRCODE='22023';
  END IF;
 END LOOP;
 -- Sérialise les renommages et les réaffectations de synonymes entre termes.
 PERFORM pg_advisory_xact_lock(hashtextextended('expense_term_labels',0));
 IF p_term_id IS NOT NULL THEN
  SELECT * INTO v_before FROM expense_terms WHERE id=p_term_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_term_not_found' USING ERRCODE='P0002'; END IF;
  IF trim(p_code) <> v_before.code THEN RAISE EXCEPTION 'expense_term_code_immutable' USING ERRCODE='22023'; END IF;
  IF (trim(p_name) <> v_before.name OR p_category_id IS DISTINCT FROM v_before.category_id)
    AND EXISTS(SELECT 1 FROM expenses WHERE expense_term_id=p_term_id) THEN
   RAISE EXCEPTION 'expense_term_in_use' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_term_id IS NULL OR p_category_id IS DISTINCT FROM v_before.category_id OR
    (p_is_active AND NOT v_before.is_active) THEN
  PERFORM 1 FROM expense_categories c JOIN accounts a ON a.id=c.account_id
    WHERE c.id=p_category_id AND c.is_active AND a.account_class=6 AND a.is_active
    AND a.is_postable AND a.deleted_at IS NULL FOR SHARE OF c,a;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_term_category_unavailable' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_term_id IS NULL THEN
  INSERT INTO expense_terms(code,name,category_id,is_active)
   VALUES(trim(p_code),trim(p_name),p_category_id,p_is_active) RETURNING id INTO v_id;
 ELSE
  v_id:=p_term_id;
  UPDATE expense_terms SET name=trim(p_name),category_id=p_category_id,is_active=p_is_active WHERE id=v_id;
 END IF;
 DELETE FROM expense_term_labels WHERE term_id=v_id;
 INSERT INTO expense_term_labels(label_key,term_id,label)
 SELECT DISTINCT ON (lower(regexp_replace(trim(label),'\s+',' ','g')))
   lower(regexp_replace(trim(label),'\s+',' ','g')),v_id,trim(label)
 FROM unnest(array_prepend(trim(p_name),p_aliases)) AS labels(label)
 ORDER BY lower(regexp_replace(trim(label),'\s+',' ','g')), (trim(label)=trim(p_name)) DESC;
 v_after:=jsonb_build_object('term',(SELECT to_jsonb(t) FROM expense_terms t WHERE id=v_id),'aliases',to_jsonb(p_aliases));
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,CASE WHEN p_term_id IS NULL THEN 'expense_term.created' ELSE 'expense_term.updated' END,
  'expense_term',v_id,'{}',jsonb_build_object('before',to_jsonb(v_before),'after',v_after));
 RETURN v_id;
END $$;

CREATE FUNCTION public.guard_expense_term_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_term expense_terms%ROWTYPE;
BEGIN
 -- Les états et justificatifs des anciennes dépenses restent modifiables selon leurs droits existants.
 IF TG_OP='UPDATE' AND NEW.expense_term_id IS NOT DISTINCT FROM OLD.expense_term_id
    AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
    AND NEW.description IS NOT DISTINCT FROM OLD.description THEN RETURN NEW; END IF;
 IF NEW.expense_term_id IS NULL THEN
  IF TG_OP='INSERT' AND NOT NEW.is_historical_import THEN
   RAISE EXCEPTION 'expense_term_required' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND OLD.expense_term_id IS NOT NULL THEN
   RAISE EXCEPTION 'expense_term_required' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO v_term FROM expense_terms WHERE id=NEW.expense_term_id FOR SHARE;
 IF NOT FOUND OR NOT v_term.is_active THEN RAISE EXCEPTION 'expense_term_unavailable' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM expense_categories c JOIN accounts a ON a.id=c.account_id WHERE c.id=v_term.category_id
  AND c.is_active AND a.is_active AND a.is_postable AND a.deleted_at IS NULL FOR SHARE OF c,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'expense_term_category_unavailable' USING ERRCODE='22023'; END IF;
 IF NEW.category_id IS DISTINCT FROM v_term.category_id THEN
  RAISE EXCEPTION 'expense_term_category_mismatch' USING ERRCODE='22023';
 END IF;
 NEW.description:=v_term.name;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_expense_term_assignment BEFORE INSERT OR UPDATE OF expense_term_id,category_id,description
 ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.guard_expense_term_assignment();

-- Libellés initiaux rattachés aux catégories existantes, sans créer de compte.
INSERT INTO public.expense_terms(code,name,category_id)
SELECT v.code,v.name,c.id FROM (VALUES
 ('ELECTRICITY','Electricity','UTILITIES'),('WATER','Water','UTILITIES'),('INTERNET','Internet','UTILITIES'),
 ('PREMISES_RENT','Premises rent','RENT'),('SALARY','Salary and wages','SALARIES'),
 ('CLEANING_DETERGENT','Cleaning detergent','SUPPLIES'),('DISHWASHING_LIQUID','Dishwashing liquid','SUPPLIES'),
 ('SPONGES','Cleaning sponges','SUPPLIES'),('TRASH_BAGS','Trash bags','SUPPLIES'),
 ('TOILET_PAPER','Toilet paper','SUPPLIES'),('PAPER_TOWELS','Paper towels','SUPPLIES'),
 ('EQUIPMENT_REPAIR','Equipment repair','MAINTENANCE'),('PLUMBING_REPAIR','Plumbing repair','MAINTENANCE'),
 ('ELECTRICAL_REPAIR','Electrical repair','MAINTENANCE'),('ONLINE_ADVERTISING','Online advertising','MARKETING'),
 ('MARKETING_PRINTING','Marketing printing','MARKETING'),('DELIVERY_TRANSPORT','Delivery transport','TRANSPORT'),
 ('PARKING','Parking','TRANSPORT'),('PRINTER_PAPER','Printer paper','OFFICE'),('PRINTER_INK','Printer ink','OFFICE'),
 ('PENS','Pens','OFFICE'),('BANK_CHARGES','Bank charges','BANK_FEES'),('BUSINESS_INSURANCE','Business insurance','INSURANCE')
) v(code,name,category) JOIN public.expense_categories c ON c.code=v.category
 JOIN public.accounts a ON a.id=c.account_id WHERE c.is_active AND a.is_active AND a.is_postable AND a.account_class=6 AND a.deleted_at IS NULL;
INSERT INTO public.expense_term_labels(label_key,term_id,label)
 SELECT lower(regexp_replace(trim(name),'\s+',' ','g')),id,name FROM public.expense_terms;
INSERT INTO public.expense_term_labels(label_key,term_id,label)
 SELECT lower(v.label),t.id,v.label FROM (VALUES
 ('ELECTRICITY','PLN'),('ELECTRICITY','Listrik'),('ELECTRICITY','Électricité'),('ELECTRICITY','Facture PLN'),
 ('WATER','PDAM'),('WATER','Eau'),('INTERNET','WiFi'),('DISHWASHING_LIQUID','Sabun cuci piring'),
 ('TRASH_BAGS','Kantong sampah'),('CLEANING_DETERGENT','Détergent')
 ) v(code,label) JOIN public.expense_terms t ON t.code=v.code;

REVOKE ALL ON FUNCTION public.get_expense_terms_v1(boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_expense_term_v1(text,text,uuid,text[],boolean,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.guard_expense_term_assignment() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_expense_terms_v1(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_expense_term_v1(text,text,uuid,text[],boolean,uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Bump depuis pg_get_functiondef, V3 dev, 30 octobre 2026.
CREATE OR REPLACE FUNCTION public.create_expense_v4(p_category_id uuid, p_amount numeric, p_payment_method text, p_description text, p_expense_date date, p_vat_amount numeric DEFAULT 0, p_vendor_name text DEFAULT NULL::text, p_receipt_url text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_expense_term_id uuid DEFAULT NULL::uuid, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_existing_id    UUID;
  v_new_id         UUID;
  v_expense_no     TEXT;
  v_term public.expense_terms%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'create_expense_v4: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.create')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'create_expense_v4: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'create_expense_v4: amount must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_vat_amount < 0 THEN
    RAISE EXCEPTION 'create_expense_v4: vat_amount must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('cash','transfer','card','credit') THEN
    RAISE EXCEPTION 'create_expense_v4: invalid payment_method %', p_payment_method USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'create_expense_v4: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  v_existing_id := _read_expense_creation_v1(p_idempotency_key, v_caller_profile);
  IF v_existing_id IS NOT NULL THEN
    INSERT INTO public.expense_creation_results(idempotency_key,actor_id,expense_id)
      VALUES(p_idempotency_key,v_caller_profile,v_existing_id) ON CONFLICT(idempotency_key) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
      VALUES(v_caller_profile,'expense.creation_recovered','expense',v_existing_id,
        jsonb_build_object('legacy_draft',true));
    END IF;
    RETURN public._read_expense_creation_v1(p_idempotency_key,v_caller_profile);
  END IF;
  IF NULLIF(p_receipt_url, '') IS NOT NULL THEN
    RAISE EXCEPTION 'receipt_requires_saved_draft' USING ERRCODE = '22023';
  END IF;



  SELECT * INTO v_term FROM public.expense_terms WHERE id=p_expense_term_id AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_term_required' USING ERRCODE='22023'; END IF;
  IF p_category_id IS DISTINCT FROM v_term.category_id THEN
    RAISE EXCEPTION 'expense_term_category_mismatch' USING ERRCODE='22023';
  END IF;
  IF length(p_remarks)>2000 THEN RAISE EXCEPTION 'expense_remarks_too_long' USING ERRCODE='22023'; END IF;
  v_expense_no := next_expense_number(p_expense_date);

  BEGIN
  INSERT INTO expenses (
    expense_number, category_id, amount, vat_amount, payment_method,
    description, vendor_name, expense_date, receipt_url, status,
    created_by, idempotency_key, expense_term_id, remarks
  ) VALUES (
    v_expense_no, p_category_id, p_amount, p_vat_amount, p_payment_method,
    v_term.name, p_vendor_name, p_expense_date, NULL, 'draft',
    v_caller_profile, p_idempotency_key, p_expense_term_id, nullif(trim(p_remarks),'')
  )
  RETURNING id INTO v_new_id;
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.expense_creation_results(idempotency_key,actor_id,expense_id)
    VALUES(p_idempotency_key,v_caller_profile,v_new_id);
  END IF;
  EXCEPTION WHEN unique_violation THEN
    v_existing_id := _read_expense_creation_v1(p_idempotency_key, v_caller_profile);
    IF v_existing_id IS NULL THEN RAISE; END IF;
    RETURN v_existing_id;
  END;

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_profile, 'expense.create', 'expense', v_new_id,
          jsonb_build_object('expense_number', v_expense_no, 'amount', p_amount));

  RETURN v_new_id;
END $function$
;
DROP FUNCTION public.create_expense_v3(uuid,numeric,text,text,date,numeric,text,text,uuid);
REVOKE ALL ON FUNCTION public.create_expense_v4(uuid,numeric,text,text,date,numeric,text,text,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_expense_v4(uuid,numeric,text,text,date,numeric,text,text,uuid,uuid,text) TO authenticated,service_role;
