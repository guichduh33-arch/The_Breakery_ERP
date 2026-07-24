-- 20260724000217_business_hours_column_set_setting_v8.sql
-- ADR-006 déc. 9 — business hours : horaires d'ouverture pour marquer les
-- ventes hors-horaire dans les rapports d'audit (signal fraude).
--
-- Colonne `business_hours` (catégorie business) : objet JSONB
--   { "mon": {"open":"07:00","close":"22:00"}, ..., "sun": null }
-- `null` = jour fermé ; clé ABSENTE = jour non configuré (jamais marqué).
--
-- Pattern « bump depuis le corps live » (cf. _210/_213) : corps de v7 (28 KB)
-- lu via pg_get_functiondef à l'apply, renommé v8, branche greffée par
-- replace() chirurgical gardé (le bloc d'écriture payment_method_fees
-- n'existe qu'une fois), puis EXECUTE. Versioning monotone : v7 droppée ici.

ALTER TABLE business_config
  ADD COLUMN business_hours JSONB NOT NULL DEFAULT '{}'::jsonb
  CONSTRAINT business_config_business_hours_object
    CHECK (jsonb_typeof(business_hours) = 'object');

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$      SELECT payment_method_fees INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET payment_method_fees = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
  graft TEXT := $q$      SELECT payment_method_fees INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET payment_method_fees = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    -- ADR-006 déc. 9 : horaires d'ouverture par jour de semaine.
    -- null = jour fermé ; clé absente = jour non configuré.
    WHEN 'business_hours' THEN
      IF jsonb_typeof(p_value) <> 'object' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'business_hours expects object';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_each(p_value) AS d(k, v)
        WHERE d.k NOT IN ('mon','tue','wed','thu','fri','sat','sun')
      ) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'unknown day key in business_hours';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_each(p_value) AS d(k, v)
        WHERE jsonb_typeof(d.v) <> 'null'
          AND (
            jsonb_typeof(d.v) <> 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(d.v)) <> 2
            OR d.v->>'open'  IS NULL
            OR d.v->>'close' IS NULL
            OR d.v->>'open'  !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            OR d.v->>'close' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            OR d.v->>'open' >= d.v->>'close'
          )
      ) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'business_hours day must be null or {open, close} in HH:MM with open < close';
      END IF;
      SELECT business_hours INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET business_hours = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
BEGIN
  src := pg_get_functiondef('set_setting_v7(text,jsonb,text)'::regprocedure);

  IF position('public.set_setting_v7(p_key text' IN src) = 0 THEN
    RAISE EXCEPTION 'set_setting_v7 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.set_setting_v7(p_key text',
                      'public.set_setting_v8(p_key text');

  -- Le bloc d'écriture payment_method_fees n'existe qu'une fois.
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one payment_method_fees write block in set_setting_v7 — live body drifted, abort';
  END IF;
  src := replace(src, needle, graft);

  EXECUTE src;
END
$do$;

-- Versioning monotone : v7 droppée dans la même migration.
DROP FUNCTION public.set_setting_v7(text, jsonb, text);

-- Grants — miroir de v7 (_213).
REVOKE EXECUTE ON FUNCTION public.set_setting_v8(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v8(text, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v8(text, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_setting_v8(text, jsonb, text) IS
  'Bump of set_setting_v7 (ADR-006 dec. 9 business hours): new key '
  'business_hours (per-weekday {open, close} HH:MM windows, null = closed '
  'day, absent key = unconfigured). Every other key branch is byte-identical '
  'to v7 (body lifted from the live definition at apply time).';
