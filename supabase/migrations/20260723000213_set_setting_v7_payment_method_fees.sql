-- 20260723000213_set_setting_v7_payment_method_fees.sql
-- ADR-006 déc. 9 (lot C) — set_setting_v7 : nouvelle clé `payment_method_fees`
-- (catégorie payments). Objet { "<method>": <percent> }, clés ∈ enum
-- payment_method, valeurs numériques dans [0, 100]. Informatif seulement.
--
-- Pattern « bump depuis le corps live » (cf. _210/_211) : corps de v6 (27 KB)
-- lu via pg_get_functiondef à l'apply, renommé v7, branche greffée par
-- replace() chirurgical gardé (le bloc d'écriture enabled_payment_methods
-- n'existe qu'une fois), puis EXECUTE. Versioning monotone : v6 droppée ici.

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$      SELECT enabled_payment_methods INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET enabled_payment_methods = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
  graft TEXT := $q$      SELECT enabled_payment_methods INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET enabled_payment_methods = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    -- Lot C (ADR-006 déc. 9) : frais informatifs par méthode, pourcentage seul.
    WHEN 'payment_method_fees' THEN
      IF jsonb_typeof(p_value) <> 'object' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'payment_method_fees expects object';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_each(p_value) AS f(k, v)
        WHERE f.k NOT IN ('cash','card','qris','edc','transfer','store_credit','gopay','ovo','dana')
      ) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'unknown payment method in payment_method_fees';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_each(p_value) AS f(k, v)
        WHERE jsonb_typeof(f.v) <> 'number'
           OR (f.v #>> '{}')::NUMERIC < 0
           OR (f.v #>> '{}')::NUMERIC > 100
      ) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'payment_method_fees values must be numeric percentages in [0, 100]';
      END IF;
      SELECT payment_method_fees INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET payment_method_fees = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
BEGIN
  src := pg_get_functiondef('set_setting_v6(text,jsonb,text)'::regprocedure);

  IF position('public.set_setting_v6(p_key text' IN src) = 0 THEN
    RAISE EXCEPTION 'set_setting_v6 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.set_setting_v6(p_key text',
                      'public.set_setting_v7(p_key text');

  -- Le bloc d'écriture enabled_payment_methods n'existe qu'une fois.
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one enabled_payment_methods write block in set_setting_v6 — live body drifted, abort';
  END IF;
  src := replace(src, needle, graft);

  EXECUTE src;
END
$do$;

-- Versioning monotone : v6 droppée dans la même migration.
DROP FUNCTION public.set_setting_v6(text, jsonb, text);

-- Grants — miroir de v6 (_211).
REVOKE EXECUTE ON FUNCTION public.set_setting_v7(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v7(text, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v7(text, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_setting_v7(text, jsonb, text) IS
  'Bump of set_setting_v6 (lot C ADR-006 dec. 9): new key payment_method_fees '
  '(informational fee percentages per payment method, object of [0,100] '
  'numbers). Every other key branch is byte-identical to v6 (body lifted from '
  'the live definition at apply time).';
