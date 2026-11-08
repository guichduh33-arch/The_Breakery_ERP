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
    ('public.record_production_v11(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,public.waste_reason)',
     '4727ad6df3e365fc0495c91ef57bc867'),
    ('public.record_batch_production_v13(jsonb,jsonb)',
     '359b9e85ba7935fa7d8c0afc5855e1e8'),
    ('public.record_kitchen_production_v6(jsonb)',
     '117bc785ecec71cca55eb621da4e99d7')
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
