-- 20260724000220_pin_policy_set_setting_v9.sql
-- ADR-006 déc. 9 — PIN policy configurable (périmètre arbitré 2026-07-24 :
-- lockout login seul ; le garde per-IP manager-pin reste une constante infra,
-- l'expiration PIN n'existe pas dans le code — signalé, non implémenté).
--
-- Nouvelle catégorie settings `security` : pin_max_failed (tentatives avant
-- lockout, défaut 5, bornes 3-10) + pin_lockout_minutes (durée du lockout,
-- défaut 15, bornes 5-120). L'EF auth-verify-pin lit ces valeurs à chaque
-- login (fallback 5/15 si lecture impossible).
--
-- Pattern « bump depuis le corps live » (cf. _213/_217) : set_setting_v8 →
-- v9 (2 branches greffées après le bloc business_hours),
-- get_settings_by_category_v6 → v7 (branche catégorie security greffée avant
-- localization). Versioning monotone : v8/v6 droppées ici.

ALTER TABLE business_config
  ADD COLUMN pin_max_failed INTEGER NOT NULL DEFAULT 5
    CONSTRAINT business_config_pin_max_failed_range CHECK (pin_max_failed BETWEEN 3 AND 10),
  ADD COLUMN pin_lockout_minutes INTEGER NOT NULL DEFAULT 15
    CONSTRAINT business_config_pin_lockout_minutes_range CHECK (pin_lockout_minutes BETWEEN 5 AND 120);

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$      SELECT business_hours INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET business_hours = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
  graft TEXT := $q$      SELECT business_hours INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET business_hours = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;

    -- ADR-006 déc. 9 : PIN policy — lockout login configurable (catégorie security).
    WHEN 'pin_max_failed' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'pin_max_failed expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 3
         OR (p_value #>> '{}')::NUMERIC > 10 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'pin_max_failed must be an integer in [3, 10]';
      END IF;
      SELECT to_jsonb(pin_max_failed) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pin_max_failed = (p_value #>> '{}')::INTEGER, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pin_lockout_minutes' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'pin_lockout_minutes expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 5
         OR (p_value #>> '{}')::NUMERIC > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'pin_lockout_minutes must be an integer in [5, 120]';
      END IF;
      SELECT to_jsonb(pin_lockout_minutes) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pin_lockout_minutes = (p_value #>> '{}')::INTEGER, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
BEGIN
  src := pg_get_functiondef('set_setting_v8(text,jsonb,text)'::regprocedure);

  IF position('public.set_setting_v8(p_key text' IN src) = 0 THEN
    RAISE EXCEPTION 'set_setting_v8 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.set_setting_v8(p_key text',
                      'public.set_setting_v9(p_key text');

  -- Le bloc d'écriture business_hours n'existe qu'une fois.
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one business_hours write block in set_setting_v8 — live body drifted, abort';
  END IF;
  src := replace(src, needle, graft);

  EXECUTE src;
END
$do$;

DROP FUNCTION public.set_setting_v8(text, jsonb, text);

REVOKE EXECUTE ON FUNCTION public.set_setting_v9(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v9(text, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v9(text, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_setting_v9(text, jsonb, text) IS
  'Bump of set_setting_v8 (ADR-006 dec. 9 PIN policy): new keys '
  'pin_max_failed [3,10] and pin_lockout_minutes [5,120] (category security, '
  'read by the auth-verify-pin edge function). Every other key branch is '
  'byte-identical to v8 (body lifted from the live definition at apply time).';

-- get_settings_by_category : nouvelle catégorie security.
DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$      WHEN 'localization' THEN jsonb_build_object($q$;
BEGIN
  src := pg_get_functiondef('get_settings_by_category_v6(text)'::regprocedure);

  IF position('public.get_settings_by_category_v6(p_category text' IN src) = 0 THEN
    RAISE EXCEPTION 'get_settings_by_category_v6 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.get_settings_by_category_v6(p_category text',
                      'public.get_settings_by_category_v7(p_category text');

  -- La branche localization n'existe qu'une fois.
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one localization branch in get_settings_by_category_v6 — live body drifted, abort';
  END IF;
  src := replace(src, needle,
                 $q$      WHEN 'security' THEN jsonb_build_object(
        'pin_max_failed',      v_row.pin_max_failed,
        'pin_lockout_minutes', v_row.pin_lockout_minutes
      )
      WHEN 'localization' THEN jsonb_build_object($q$);

  EXECUTE src;
END
$do$;

DROP FUNCTION public.get_settings_by_category_v6(text);

REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v7(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v7(text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v7(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_settings_by_category_v7(text) IS
  'Bump of get_settings_by_category_v6 (ADR-006 dec. 9 PIN policy): new '
  'security category returning pin_max_failed + pin_lockout_minutes. Every '
  'other category branch is byte-identical to v6 (body lifted from the live '
  'definition at apply time).';
