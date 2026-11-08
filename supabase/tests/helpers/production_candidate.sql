-- Vérifier les API publiées sans recréer de contrat supprimé.
-- Empreintes des corps live DEV relevées le 8 novembre 2026.
CREATE TEMP TABLE _production_candidate_guard (active boolean) ON COMMIT DROP;
DO $candidate$
DECLARE
  f record;
  candidate regprocedure;
BEGIN
  IF to_regclass('pg_temp._production_candidate_guard') IS NULL THEN
    RAISE EXCEPTION 'production_candidate_requires_transaction';
  END IF;
  FOR f IN SELECT * FROM (VALUES
    ('public.record_production_v12(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,public.waste_reason)',
     '3de45b16bcc5796f46f6e2a619279961'),
    ('public.record_batch_production_v14(jsonb,jsonb)',
     '85a7449079c5644d85f6ee7b8191315b'),
    ('public.record_kitchen_production_v7(jsonb)',
     'c045019db83326f41aae94336690c6c1')
  ) AS functions(signature, expected_md5) LOOP
    candidate := to_regprocedure(f.signature);
    IF candidate IS NULL THEN
      RAISE EXCEPTION 'production_candidate_missing: %', f.signature;
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
