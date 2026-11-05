-- Vérifier les API publiées sans recréer de contrat supprimé.
-- Empreintes des corps live DEV relevées le 5 novembre 2026.
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
    ('public.record_production_v10(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,public.waste_reason)',
     '0807ee407873794868f3ccb66b10f9c9'),
    ('public.record_batch_production_v12(jsonb,jsonb)',
     'd3126db7953bde0455a305314d819e2b'),
    ('public.record_kitchen_production_v5(jsonb)',
     'e5aee8a62fa9771015e0c3208d999b7e')
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
