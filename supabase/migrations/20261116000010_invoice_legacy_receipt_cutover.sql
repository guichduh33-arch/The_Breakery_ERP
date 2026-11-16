-- Convergence ciblée du schéma partiel, sans réexécuter les migrations historiques.
-- Définitions DEV capturées le 08/11/2026 ; une version publiée divergente bloque.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE
 v_setting text; v_unit text; v_tx_ms bigint;
 v_po_path boolean; v_po_exempt boolean; v_exp_exempt boolean;
 v_helper_missing boolean; v_po_ledger oid;
 v_import text[]; v_import_valid boolean;
 v_ax text[]:=ARRAY['storage.objects'];
 v_srx text[]:=ARRAY['public.expenses','public.expense_approvals',
   'public.purchase_orders','public.purchase_payments'];
 v_as text[]:=ARRAY[]::text[];
 v_drop text[]; v_plan jsonb; r record;
 v_catalog_before jsonb; v_catalog_after jsonb;
 v_relations_before jsonb; v_relations_after jsonb;
 -- Une seule définition pour les relevés avant et sous les verrous.
 v_catalog_sql constant text:=$catalog$
  WITH imports AS (
   SELECT format('%I.%I',n.nspname,c.relname) AS rel,g.oid,g.tgname,
    g.tgenabled,g.tgtype,g.tgisinternal,g.tgfoid,c.relkind
   FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid
   JOIN pg_namespace pn ON pn.oid=p.pronamespace
   JOIN pg_class c ON c.oid=g.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND pn.nspname='public'
    AND p.proname IN('_historical_import_entity_guard_v1',
     '_historical_import_entity_guard_v2')
  ), drops AS (
   SELECT format('public.%I',w.rel) AS rel,g.oid,g.tgname,
    g.tgenabled,g.tgtype,g.tgisinternal,g.tgfoid
   FROM (VALUES
    ('expenses','invoice_required_before_payment'),
    ('expenses','invoice_fields_guard'),
    ('expense_approvals','invoice_required_before_approval'),
    ('purchase_orders','invoice_fields_guard'),
    ('purchase_payments','invoice_required_before_payment')
   ) w(rel,trg)
   JOIN pg_trigger g ON g.tgrelid=to_regclass('public.'||w.rel)
    AND g.tgname=w.trg
  )
  SELECT jsonb_build_object(
   'po_path',EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid=to_regclass('public.purchase_orders')
     AND attname='invoice_path' AND NOT attisdropped),
   'po_exempt',EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid=to_regclass('public.purchase_orders')
     AND attname='invoice_exempt' AND NOT attisdropped),
   'exp_exempt',EXISTS(SELECT 1 FROM pg_attribute
    WHERE attrelid=to_regclass('public.expenses')
     AND attname='invoice_exempt' AND NOT attisdropped),
   'imports',(SELECT coalesce(jsonb_agg(to_jsonb(i)
     ORDER BY rel COLLATE "C",tgname COLLATE "C",oid),'[]'::jsonb) FROM imports i),
   'drops',(SELECT coalesce(jsonb_agg(to_jsonb(d)
     ORDER BY rel COLLATE "C",tgname COLLATE "C",oid),'[]'::jsonb) FROM drops d),
   'po_ledger',to_regclass('public.po_invoice_results')::oid,
   'helper_missing',to_regprocedure(
    'public._imported_before_invoice_cutoff_v1(text,uuid)') IS NULL)
 $catalog$;
 v_relations_sql constant text:=$relations$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'rel',p.rel,'strength',p.strength,'oid',c.oid,'kind',c.relkind,
   'partition',c.relispartition,'inheritance',(SELECT coalesce(
    jsonb_agg(jsonb_build_object('parent',i.inhparent,'child',i.inhrelid)
     ORDER BY i.inhparent,i.inhrelid),'[]'::jsonb)
    FROM pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid))
   ORDER BY p.rel COLLATE "C"),'[]'::jsonb)
  FROM jsonb_to_recordset($1) AS p(rel text,strength integer)
  LEFT JOIN pg_class c ON c.oid=to_regclass(p.rel)
 $relations$;
BEGIN
 -- Ne jamais désarmer ni prolonger un timer hérité.
 SELECT setting,unit INTO v_setting,v_unit
 FROM pg_settings WHERE name='transaction_timeout';
 IF NOT FOUND OR v_unit IS DISTINCT FROM 'ms'
    OR v_setting !~ '^[0-9]+$' THEN
  RAISE EXCEPTION 'invoice_transaction_timeout_unavailable';
 END IF;
 v_tx_ms:=v_setting::bigint;
 IF v_tx_ms>5000 THEN
  RAISE EXCEPTION 'invoice_transaction_timeout_exceeds_cap';
 ELSIF v_tx_ms=0 THEN
  PERFORM set_config('transaction_timeout','5s',true);
 END IF;

 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'invoice_transaction_isolation_unsupported';
 END IF;
 EXECUTE v_catalog_sql INTO v_catalog_before;
 v_po_path:=(v_catalog_before->>'po_path')::boolean;
 v_po_exempt:=(v_catalog_before->>'po_exempt')::boolean;
 v_exp_exempt:=(v_catalog_before->>'exp_exempt')::boolean;
 IF NOT v_po_path OR NOT v_po_exempt THEN
  v_ax:=array_append(v_ax,'public.purchase_orders');
 END IF;
 IF NOT v_exp_exempt THEN
  v_ax:=array_append(v_ax,'public.expenses');
 END IF;

 SELECT array_agg(j.value->>'rel' ORDER BY (j.value->>'rel') COLLATE "C"),
  bool_and(j.value->>'tgenabled'='O'
   AND j.value->>'tgname'='financial_import_entity_guard'
   AND NOT (j.value->>'tgisinternal')::boolean AND j.value->>'relkind'='r')
 INTO v_import,v_import_valid
 FROM jsonb_array_elements(v_catalog_before->'imports') j;
 IF v_import_valid IS DISTINCT FROM true
  OR v_import IS DISTINCT FROM ARRAY[
   'public.b2b_payment_allocations','public.b2b_payments',
   'public.goods_receipt_notes','public.order_items',
   'public.order_payments','public.orders',
   'public.purchase_order_items','public.purchase_orders',
   'public.purchase_payments','public.refunds'] THEN
  RAISE EXCEPTION 'invoice_import_trigger_drift';
 END IF;
 v_ax:=v_ax||v_import;

 -- AX seulement quand un trigger sera effectivement supprimé.
 SELECT array_agg(DISTINCT j.value->>'rel') INTO v_drop
 FROM jsonb_array_elements(v_catalog_before->'drops') j;
 v_ax:=v_ax||coalesce(v_drop,ARRAY[]::text[]);
 v_po_ledger:=(v_catalog_before->>'po_ledger')::oid;
 IF v_po_ledger IS NULL THEN
  v_srx:=array_append(v_srx,'public.user_profiles');
 ELSE
  v_ax:=array_append(v_ax,'public.po_invoice_results');
 END IF;
 v_helper_missing:=(v_catalog_before->>'helper_missing')::boolean;
 IF v_helper_missing OR NOT v_po_exempt THEN
  v_as:=v_as||ARRAY['public.historical_import_documents',
    'public.historical_import_runs'];
 END IF;
 IF v_helper_missing OR NOT v_exp_exempt THEN
  v_as:=v_as||ARRAY['public.cash_journal_import_rows',
    'public.audit_logs'];
 END IF;

 -- Tous les modes finaux, dédupliqués, dans un ordre stable.
 SELECT jsonb_agg(to_jsonb(p) ORDER BY p.rel COLLATE "C") INTO v_plan
 FROM (SELECT rel,max(strength) AS strength FROM (
   SELECT unnest(v_as) AS rel,1 AS strength
   UNION ALL SELECT 'storage.buckets',2
   UNION ALL SELECT unnest(v_srx),3
   UNION ALL SELECT unnest(v_ax),4
  ) locks GROUP BY rel) p;
 EXECUTE v_relations_sql INTO v_relations_before USING v_plan;
 FOR r IN SELECT * FROM jsonb_to_recordset(v_relations_before)
  AS p(rel text,strength integer,oid oid,kind text,partition boolean,inheritance jsonb)
  ORDER BY rel COLLATE "C"
 LOOP
  IF r.oid IS NULL OR r.kind<>'r' OR r.partition
   OR jsonb_array_length(r.inheritance)<>0 THEN
   RAISE EXCEPTION 'invoice_lock_relation_drift: %',r.rel;
  END IF;
  EXECUTE format('LOCK TABLE ONLY %s IN %s MODE NOWAIT',r.rel,
   CASE r.strength WHEN 1 THEN 'ACCESS SHARE'
    WHEN 2 THEN 'ROW EXCLUSIVE'
    WHEN 3 THEN 'SHARE ROW EXCLUSIVE'
    ELSE 'ACCESS EXCLUSIVE' END);
  IF to_regclass(r.rel) IS DISTINCT FROM r.oid THEN
   RAISE EXCEPTION 'invoice_lock_relation_drift: %',r.rel;
  END IF;
 END LOOP;

 -- Les lignes absentes ne sont pas artificiellement créées.
 PERFORM b.id FROM storage.buckets b
 WHERE b.id IN('expense-receipts','purchase-invoices')
 ORDER BY b.id COLLATE "C" FOR UPDATE NOWAIT;

 -- Refuser un plan devenu périmé avant le premier DDL.
 -- Le gel DDL reste requis : les routines de catalogue ne sont pas verrouillées.
 EXECUTE v_catalog_sql INTO v_catalog_after;
 EXECUTE v_relations_sql INTO v_relations_after USING v_plan;
 IF v_catalog_after IS DISTINCT FROM v_catalog_before
  OR v_relations_after IS DISTINCT FROM v_relations_before THEN
  RAISE EXCEPTION 'invoice_lock_plan_drift';
 END IF;
END $preflight$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TEMP TABLE invoice_cutover_columns(entity text PRIMARY KEY) ON COMMIT DROP;
DO $columns$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.purchase_orders'::regclass AND attname='invoice_path' AND NOT attisdropped) THEN
  ALTER TABLE public.purchase_orders ADD COLUMN invoice_path text;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.purchase_orders'::regclass AND attname='invoice_exempt' AND NOT attisdropped) THEN
  ALTER TABLE public.purchase_orders ADD COLUMN invoice_exempt boolean NOT NULL DEFAULT false;
  INSERT INTO invoice_cutover_columns VALUES('purchase_order');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.expenses'::regclass AND attname='invoice_exempt' AND NOT attisdropped) THEN
  ALTER TABLE public.expenses ADD COLUMN invoice_exempt boolean NOT NULL DEFAULT false;
  INSERT INTO invoice_cutover_columns VALUES('expense');
 END IF;
 IF EXISTS(SELECT 1 FROM (VALUES('purchase_orders','invoice_path','text'::regtype,false),
   ('purchase_orders','invoice_exempt','boolean'::regtype,true),('expenses','invoice_exempt','boolean'::regtype,true)) x(t,c,typ,nn)
  LEFT JOIN pg_attribute a ON a.attrelid=('public.'||x.t)::regclass AND a.attname=x.c AND NOT a.attisdropped
  WHERE a.attnum IS NULL OR a.atttypid<>x.typ OR a.attnotnull<>x.nn) THEN
  RAISE EXCEPTION 'invoice_column_drift'; END IF;
END $columns$;
DO $adopt$ DECLARE f regprocedure:=to_regprocedure('public._imported_before_invoice_cutoff_v1(text,uuid)'); BEGIN
 IF f IS NULL THEN EXECUTE $definition$CREATE FUNCTION public._imported_before_invoice_cutoff_v1(p_kind text, p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE p_kind WHEN 'purchase_order' THEN EXISTS(
  SELECT 1 FROM public.purchase_orders p JOIN public.historical_import_documents d ON p.financial_import_document_id=d.id
   JOIN public.historical_import_runs r ON r.id=d.run_id
  WHERE p.id=p_id AND d.entity_id=p.id AND d.kind='purchases' AND r.kind=d.kind
   AND r.source_system=d.source_system AND r.status='applied'
   AND d.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar'
   AND r.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar')
 WHEN 'expense' THEN EXISTS(SELECT 1 FROM public.expenses e WHERE e.id=p_id AND e.is_historical_import
  AND e.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar'
  AND (EXISTS(SELECT 1 FROM public.cash_journal_import_rows c WHERE c.expense_id=e.id
    AND c.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar')
   OR EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.action='expenses.imported'
    AND a.actor_id=e.created_by AND a.created_at=e.created_at
    AND (a.entity_id=e.id OR (a.entity_id IS NULL AND e.expense_number LIKE 'IMP-EXP-%')))))
 ELSE false END
$function$;$definition$;
 ELSIF (md5(pg_get_functiondef(f)) <> 'bc0a46dc1f0e264208c889f9d9e5c50a' AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> 'f1fedbf8a69361c9f94a6db71b9a5fcc') THEN RAISE EXCEPTION 'invoice_definition_drift: _imported_before_invoice_cutoff_v1(text,uuid)'; END IF;
END $adopt$;
REVOKE ALL ON FUNCTION public._imported_before_invoice_cutoff_v1(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $adopt$ DECLARE f regprocedure:=to_regprocedure('public._payment_invoice_valid_v1(text,text,text)'); BEGIN
 IF f IS NULL THEN EXECUTE $definition$CREATE FUNCTION public._payment_invoice_valid_v1(p_bucket text, p_path text, p_prefix text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT p_path IS NOT NULL AND left(p_path,length(p_prefix))=p_prefix AND EXISTS(
  SELECT 1 FROM storage.objects o WHERE o.bucket_id=p_bucket AND o.name=p_path
   AND o.archived_at IS NULL AND NOT COALESCE(o.is_delete_marker,false)
   AND CASE WHEN COALESCE(o.metadata->>'size','') ~ '^[0-9]+$'
     THEN (o.metadata->>'size')::numeric BETWEEN 1 AND 5242880 ELSE false END
   AND ((o.metadata->>'mimetype'='application/pdf' AND p_path ~ '[.]pdf$')
     OR (o.metadata->>'mimetype'='image/jpeg' AND p_path ~ '[.](jpg|jpeg)$')))
$function$;$definition$;
 ELSIF (md5(pg_get_functiondef(f)) <> 'ead2b16d333fe556fbd0dc4892e1746b' AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> '4ee3cb2fe5b98f81e2dcc52c3069cd98') THEN RAISE EXCEPTION 'invoice_definition_drift: _payment_invoice_valid_v1(text,text,text)'; END IF;
END $adopt$;
REVOKE ALL ON FUNCTION public._payment_invoice_valid_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $adopt$ DECLARE f regprocedure:=to_regprocedure('public._guard_expense_approval_invoice_v1()'); BEGIN
 IF f IS NULL THEN EXECUTE $definition$CREATE FUNCTION public._guard_expense_approval_invoice_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e public.expenses%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.expenses WHERE id=NEW.expense_id FOR UPDATE;
 IF e.payment_method='cash' AND NOT e.invoice_exempt AND NOT public._payment_invoice_valid_v1(
  'expense-receipts',e.receipt_url,'expenses/'||e.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_approval' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;$definition$;
 ELSIF (md5(pg_get_functiondef(f)) <> '7e43845cc860693165d1d5709fa247bd' AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> 'e06b29a085b912409b5ac5eee7e24af5') THEN RAISE EXCEPTION 'invoice_definition_drift: _guard_expense_approval_invoice_v1()'; END IF;
END $adopt$;
REVOKE ALL ON FUNCTION public._guard_expense_approval_invoice_v1() FROM PUBLIC,anon,authenticated,service_role;
DO $adopt$ DECLARE f regprocedure:=to_regprocedure('public._guard_po_payment_invoice_v1()'); BEGIN
 IF f IS NULL THEN EXECUTE $definition$CREATE FUNCTION public._guard_po_payment_invoice_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p public.purchase_orders%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.purchase_orders WHERE id=NEW.purchase_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT p.invoice_exempt AND NOT public._payment_invoice_valid_v1(
   'purchase-invoices',p.invoice_path,'purchase-orders/'||p.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;$definition$;
 ELSIF (md5(pg_get_functiondef(f)) <> 'b1ce32f40ff19c1582265e69e160666f' AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> '0922b2654fd67cad44f1a693417a1381') THEN RAISE EXCEPTION 'invoice_definition_drift: _guard_po_payment_invoice_v1()'; END IF;
END $adopt$;
REVOKE ALL ON FUNCTION public._guard_po_payment_invoice_v1() FROM PUBLIC,anon,authenticated,service_role;

-- L'exemption financière dépend uniquement des registres d'import avant le 31/10.
-- Une exemption déjà figée n'est jamais recalculée. Sur un socle neuf, ce backfill
-- précède l'installation de la garde d'immutabilité ; aucune fenêtre hors transaction.
DO $old$ DECLARE f regprocedure:=to_regprocedure('public._historical_import_entity_guard_v1()'); BEGIN
 IF f IS NOT NULL AND ((md5(pg_get_functiondef(f)) NOT IN ('eb07f6947b2744833b1e14ccb62e1746','76e66637d43fd194d4e43cecf5d9d521') AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> '76f2f9a692105684b4978a2655daff5f')) THEN RAISE EXCEPTION 'invoice_definition_drift: _historical_import_entity_guard_v1()'; END IF;
END $old$;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public._historical_import_entity_guard_v2()'); BEGIN
 IF f IS NOT NULL AND ((SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> '0f326394aefa4707796c45f22a9dcb44') THEN RAISE EXCEPTION 'invoice_definition_drift: _historical_import_entity_guard_v2()'; END IF;
END $old$;
DO $exemptions$ BEGIN
 IF EXISTS(SELECT 1 FROM invoice_cutover_columns WHERE entity='purchase_order') THEN
  IF EXISTS(SELECT 1 FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE g.tgrelid='public.purchase_orders'::regclass
    AND g.tgname='financial_import_entity_guard' AND (g.tgenabled<>'O' OR n.nspname<>'public'
      OR p.proname NOT IN('_historical_import_entity_guard_v1','_historical_import_entity_guard_v2'))) THEN
   RAISE EXCEPTION 'invoice_import_trigger_drift'; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.purchase_orders'::regclass AND tgname='financial_import_entity_guard') THEN
   ALTER TABLE public.purchase_orders DISABLE TRIGGER financial_import_entity_guard;
  END IF;
  UPDATE public.purchase_orders p SET invoice_exempt=true WHERE NOT p.invoice_exempt AND public._imported_before_invoice_cutoff_v1('purchase_order',p.id);
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.purchase_orders'::regclass AND tgname='financial_import_entity_guard') THEN
   ALTER TABLE public.purchase_orders ENABLE TRIGGER financial_import_entity_guard;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM invoice_cutover_columns WHERE entity='expense') THEN
  UPDATE public.expenses e SET invoice_exempt=true WHERE NOT e.invoice_exempt AND public._imported_before_invoice_cutoff_v1('expense',e.id);
 END IF;
END $exemptions$;
DROP TABLE invoice_cutover_columns;

CREATE SCHEMA IF NOT EXISTS invoice_private;
DO $schema$ BEGIN
 IF (SELECT nspowner<>('postgres'::regrole)::oid FROM pg_namespace WHERE nspname='invoice_private') THEN
  RAISE EXCEPTION 'invoice_private_owner_drift'; END IF;
END $schema$;
REVOKE ALL ON SCHEMA invoice_private FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA invoice_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- L'identité d'objet, et non une date/clé fournie par le client, prouve l'antériorité.
CREATE TABLE invoice_private.legacy_receipt_objects(
 object_id uuid PRIMARY KEY,bucket_id text NOT NULL,name text NOT NULL,owner_id text,
 metadata_md5 text NOT NULL,captured_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE invoice_private.legacy_receipt_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoice_private.legacy_receipt_objects FROM PUBLIC,anon,authenticated,service_role;
-- Bloquer les écritures concurrentes pendant la capture et la fermeture des INSERT.
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO invoice_private.legacy_receipt_objects(object_id,bucket_id,name,owner_id,metadata_md5)
 SELECT id,bucket_id,name,COALESCE(NULLIF(owner_id,''),owner::text),md5(coalesce(metadata,'{}'::jsonb)::text)
 FROM storage.objects WHERE bucket_id='expense-receipts' AND name ~ '[.](png|webp)$'
  AND metadata->>'mimetype' IN('image/png','image/webp') AND archived_at IS NULL AND NOT coalesce(is_delete_marker,false);
CREATE FUNCTION invoice_private.is_legacy_receipt(p_path text,p_auth uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM invoice_private.legacy_receipt_objects l JOIN storage.objects o
  ON o.id=l.object_id AND o.bucket_id=l.bucket_id AND o.name=l.name
  WHERE l.bucket_id='expense-receipts' AND l.name=p_path AND l.owner_id=p_auth::text
   AND COALESCE(NULLIF(o.owner_id,''),o.owner::text)=l.owner_id
   AND md5(coalesce(o.metadata,'{}'::jsonb)::text)=l.metadata_md5
   AND o.archived_at IS NULL AND NOT coalesce(o.is_delete_marker,false))
$$;
REVOKE ALL ON FUNCTION invoice_private.is_legacy_receipt(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('expense-receipts','expense-receipts',false,5242880,ARRAY['image/jpeg','application/pdf']),
 ('purchase-invoices','purchase-invoices',false,5242880,ARRAY['image/jpeg','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
-- Restrictive : une autre policy permissive ne doit pas rouvrir les anciens formats.
CREATE POLICY invoice_new_formats ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
 WITH CHECK(bucket_id NOT IN('expense-receipts','purchase-invoices') OR name ~ '[.](jpg|jpeg|pdf)$');
CREATE POLICY invoice_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
 USING(bucket_id NOT IN('expense-receipts','purchase-invoices')) WITH CHECK(bucket_id NOT IN('expense-receipts','purchase-invoices'));
CREATE POLICY invoice_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated
 USING(bucket_id NOT IN('expense-receipts','purchase-invoices'));
