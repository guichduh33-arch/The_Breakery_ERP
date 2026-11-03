-- API candidates disponibles uniquement dans la transaction de test.
-- Les empreintes correspondent aux corps de la migration du 3 novembre 2026.
CREATE TEMP TABLE _production_candidate_guard (active boolean) ON COMMIT DROP;
DO $candidate$
DECLARE
  f record;
  definition text;
  candidate regprocedure;
BEGIN
  IF to_regclass('pg_temp._production_candidate_guard') IS NULL THEN
    RAISE EXCEPTION 'production_candidate_requires_transaction';
  END IF;
  FOR f IN SELECT * FROM (VALUES
    ('public.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,public.waste_reason)',
     'stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,public.waste_reason)',
     '3bf31465055801f81886202390729198'),
    ('public.record_batch_production_v10(jsonb,jsonb)',
     'stock_private.record_batch_production_v10(jsonb,jsonb)',
     'f07aa1ca6bb313a88c2e7f6f0b2bcbbc'),
    ('public.record_kitchen_production_v3(jsonb)',
     'stock_private.record_kitchen_production_v3(jsonb)',
     '2fd87c198db02ffb274571bf3ee52705')
  ) AS functions(signature, source_signature, expected_md5) LOOP
    candidate := to_regprocedure(f.signature);
    IF candidate IS NULL THEN
      IF to_regprocedure(f.source_signature) IS NULL THEN
        RAISE EXCEPTION 'production_candidate_source_missing: %', f.source_signature;
      END IF;
      definition := pg_get_functiondef(to_regprocedure(f.source_signature));
      definition := replace(definition, 'CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION');
      definition := replace(definition, 'stock_private.record_production_v8(', 'public.record_production_v8(');
      definition := replace(definition, 'stock_private.record_batch_production_v10(', 'public.record_batch_production_v10(');
      definition := replace(definition, 'stock_private.record_kitchen_production_v3(', 'public.record_kitchen_production_v3(');
      definition := replace(definition, 'record_production_v9(', 'record_production_v8(');
      definition := replace(definition, 'record_batch_production_v11(', 'record_batch_production_v10(');
      EXECUTE definition;
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon', f.signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role', f.signature);
      candidate := to_regprocedure(f.signature);
    END IF;
    IF md5(pg_get_functiondef(candidate)) <> f.expected_md5 THEN
      RAISE EXCEPTION 'production_candidate_definition_mismatch: %', f.signature;
    END IF;
    IF has_function_privilege('anon',candidate,'EXECUTE')
       OR NOT has_function_privilege('authenticated',candidate,'EXECUTE')
       OR NOT has_function_privilege('service_role',candidate,'EXECUTE') THEN
      RAISE EXCEPTION 'production_candidate_grant_mismatch: %', f.signature;
    END IF;
  END LOOP;
END $candidate$;
