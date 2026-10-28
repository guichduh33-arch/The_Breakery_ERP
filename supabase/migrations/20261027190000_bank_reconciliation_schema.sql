-- Rapprochement bancaire : stockage privé, droits explicites et clés durables.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

INSERT INTO public.permissions(code,module,action,description) VALUES
 ('accounting.bank.read','accounting','bank.read','Read bank reconciliation'),
 ('accounting.bank.manage','accounting','bank.manage','Import and match bank statements'),
 ('accounting.bank.validate','accounting','bank.validate','Finalize bank reconciliation'),
 ('accounting.bank.settle','accounting','bank.settle','Post bank settlements and adjustments');
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
 SELECT 'SUPER_ADMIN',code,true FROM public.permissions WHERE code LIKE 'accounting.bank.%';

CREATE TABLE public.bank_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 period_start date NOT NULL, period_end date NOT NULL,
 currency text NOT NULL CHECK(currency='IDR'),
 opening_balance numeric, closing_balance numeric,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized')),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 finalized_by uuid REFERENCES public.user_profiles(id), finalized_at timestamptz,
 snapshot jsonb, snapshot_sha256 text,
 CHECK(period_end>=period_start AND period_end-period_start<=366),
 CHECK(opening_balance IS NULL OR (opening_balance=round(opening_balance,2) AND abs(opening_balance)<1e12)),
 CHECK(closing_balance IS NULL OR (closing_balance=round(closing_balance,2) AND abs(closing_balance)<1e12)),
 CHECK((status='draft' AND finalized_at IS NULL AND snapshot IS NULL) OR
       (status='finalized' AND finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND snapshot IS NOT NULL))
);
CREATE INDEX bank_reconciliations_account_cursor ON public.bank_reconciliations(account_id,id DESC);
CREATE TABLE public.bank_statement_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id),
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 sheet_name text NOT NULL CHECK(length(sheet_name) BETWEEN 1 AND 120),
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
 payload_sha256 text NOT NULL,
 first_date date NOT NULL,last_date date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,source_sha256,sheet_name)
);
CREATE TABLE public.bank_statement_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id),
 import_id uuid NOT NULL REFERENCES public.bank_statement_imports(id),
 source_row integer NOT NULL CHECK(source_row>0),
 transaction_date date NOT NULL,
 amount numeric NOT NULL CHECK(amount<>0 AND amount=round(amount,2) AND abs(amount)<1e12),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 1000),
 reference text CHECK(length(reference)<=255),
 balance numeric CHECK(balance IS NULL OR (balance=round(balance,2) AND abs(balance)<1e12)),
 fingerprint text NOT NULL,
 UNIQUE(import_id,source_row)
);
CREATE INDEX bank_statement_lines_page ON public.bank_statement_lines(reconciliation_id,ordinal);
CREATE INDEX bank_statement_lines_fingerprint ON public.bank_statement_lines(fingerprint);
CREATE TABLE public.bank_reconciliation_matches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id),
 bank_line_ids uuid[] NOT NULL,gl_line_ids uuid[] NOT NULL,
 amount numeric NOT NULL,
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 removed_by uuid REFERENCES public.user_profiles(id),removed_at timestamptz,removal_reason text,
 CHECK(cardinality(bank_line_ids)>0 AND cardinality(gl_line_ids)>0),
 CHECK((removed_at IS NULL AND removal_reason IS NULL) OR
       (removed_at IS NOT NULL AND removed_by IS NOT NULL AND length(trim(removal_reason))>=3))
);
CREATE INDEX bank_reconciliation_matches_parent ON public.bank_reconciliation_matches(reconciliation_id);
CREATE TABLE public.bank_reconciliation_bank_claims (
 bank_line_id uuid PRIMARY KEY REFERENCES public.bank_statement_lines(id),
 match_id uuid NOT NULL REFERENCES public.bank_reconciliation_matches(id)
);
CREATE TABLE public.bank_reconciliation_gl_claims (
 gl_line_id uuid PRIMARY KEY REFERENCES public.journal_entry_lines(id),
 match_id uuid NOT NULL REFERENCES public.bank_reconciliation_matches(id)
);
CREATE TABLE public.bank_reconciliation_operations (
 idempotency_key uuid PRIMARY KEY, operation text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 payload_sha256 text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bank_reconciliation_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id),
 kind text NOT NULL CHECK(kind IN ('settlement','fee','interest')),
 bank_line_ids uuid[] NOT NULL, clearing_line_ids uuid[] NOT NULL,
 journal_entry_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries(id),
 bank_gl_line_id uuid NOT NULL UNIQUE REFERENCES public.journal_entry_lines(id),
 fee_amount numeric NOT NULL CHECK(fee_amount>=0 AND fee_amount=round(fee_amount,2)),
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.bank_reconciliation_clearing_claims (
 gl_line_id uuid PRIMARY KEY REFERENCES public.journal_entry_lines(id),
 bank_entry_id uuid NOT NULL REFERENCES public.bank_reconciliation_entries(id)
);
CREATE TABLE public.bank_reconciliation_entry_bank_claims (
 bank_line_id uuid PRIMARY KEY REFERENCES public.bank_statement_lines(id),
 bank_entry_id uuid NOT NULL REFERENCES public.bank_reconciliation_entries(id)
);
CREATE TABLE public.bank_reconciliation_transit (
 reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id),
 gl_line_id uuid NOT NULL REFERENCES public.journal_entry_lines(id),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 PRIMARY KEY(reconciliation_id,gl_line_id)
);
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['bank_reconciliations','bank_statement_imports','bank_statement_lines',
 'bank_reconciliation_matches','bank_reconciliation_bank_claims','bank_reconciliation_gl_claims',
 'bank_reconciliation_operations','bank_reconciliation_entries','bank_reconciliation_clearing_claims',
 'bank_reconciliation_transit','bank_reconciliation_entry_bank_claims']) LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.bank_statement_lines_ordinal_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._bank_actor(p_permission text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid;
BEGIN
 IF NOT public.request_has_active_pin_session_v1() THEN
  RAISE EXCEPTION 'session_expired' USING ERRCODE='PT401';
 END IF;
 SELECT id INTO v_actor FROM public.user_profiles
 WHERE auth_user_id=auth.uid() AND deleted_at IS NULL AND is_active;
 IF v_actor IS NULL OR NOT public.has_permission(auth.uid(),p_permission) OR NOT EXISTS (
  SELECT 1 FROM public.user_sessions WHERE id=(auth.jwt()->>'session_id')::uuid
   AND p_permission=ANY(permissions_snapshot)) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
 RETURN v_actor;
END $$;
CREATE FUNCTION public._bank_money(p_value jsonb,p_nullable boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE v text:=p_value#>>'{}';n numeric;
BEGIN
 IF p_value IS NULL OR p_value='null'::jsonb THEN
  IF p_nullable THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'amount_required' USING ERRCODE='22023';
 END IF;
 IF v IS NULL OR v!~'^-?[0-9]+(\.[0-9]{1,2})?$' OR length(v)>18 THEN
  RAISE EXCEPTION 'amount_requires_two_decimals' USING ERRCODE='22023';
 END IF;
 n:=v::numeric;
 IF abs(n)>=1e12 THEN RAISE EXCEPTION 'amount_out_of_range' USING ERRCODE='22023'; END IF;
 RETURN n;
END $$;
CREATE FUNCTION public._bank_audit(p_actor uuid,p_action text,p_entity uuid,p_payload jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(p_actor,p_action,'bank_reconciliation',p_entity,
  jsonb_build_object('session_id',auth.jwt()->>'session_id'),p_payload);
$$;
CREATE FUNCTION public._bank_replay(p_key uuid,p_operation text,p_actor uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE r public.bank_reconciliation_operations;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-key:'||p_key::text,0));
 SELECT * INTO r FROM public.bank_reconciliation_operations WHERE idempotency_key=p_key;
 IF FOUND THEN
  IF r.actor_id<>p_actor OR r.operation<>p_operation OR
   r.payload_sha256<>encode(extensions.digest(p_payload::text,'sha256'),'hex') THEN
   RAISE EXCEPTION 'idempotency_payload_conflict' USING ERRCODE='22023';
  END IF;
  RETURN r.result||jsonb_build_object('idempotent_replay',true);
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public._bank_remember(p_key uuid,p_operation text,p_actor uuid,p_payload jsonb,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
BEGIN
 INSERT INTO public.bank_reconciliation_operations(idempotency_key,operation,actor_id,payload_sha256,result)
 VALUES(p_key,p_operation,p_actor,encode(extensions.digest(p_payload::text,'sha256'),'hex'),p_result);
 RETURN p_result;
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname IN ('_bank_actor','_bank_money','_bank_audit','_bank_replay','_bank_remember') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
