-- 20260724000218_get_settings_by_category_v6_business_hours.sql
-- ADR-006 déc. 9 (business hours) — get_settings_by_category_v6 : la
-- catégorie `business` expose aussi `business_hours` (la v5 construit un
-- jsonb_build_object par catégorie, la nouvelle clé exige donc un bump).
--
-- Pattern « bump depuis le corps live » (cf. _214) : corps de v5 lu via
-- pg_get_functiondef à l'apply, renommé v6, clé ajoutée par replace()
-- chirurgical gardé, puis EXECUTE. Versioning monotone : v5 droppée ici.

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$'alert_email',    v_row.alert_email$q$;
BEGIN
  src := pg_get_functiondef('get_settings_by_category_v5(text)'::regprocedure);

  IF position('public.get_settings_by_category_v5(p_category text' IN src) = 0 THEN
    RAISE EXCEPTION 'get_settings_by_category_v5 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.get_settings_by_category_v5(p_category text',
                      'public.get_settings_by_category_v6(p_category text');

  -- La clé n'existe qu'une fois (branche business).
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one alert_email key in get_settings_by_category_v5 — live body drifted, abort';
  END IF;
  src := replace(src, needle,
                 $q$'alert_email',    v_row.alert_email,
        'business_hours', v_row.business_hours$q$);

  EXECUTE src;
END
$do$;

-- Versioning monotone : v5 droppée dans la même migration.
DROP FUNCTION public.get_settings_by_category_v5(text);

-- Grants — miroir de v5 (_214).
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v6(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v6(text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v6(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_settings_by_category_v6(text) IS
  'Bump of get_settings_by_category_v5 (ADR-006 dec. 9 business hours): the '
  'business category also returns business_hours. Every other category branch '
  'is byte-identical to v5 (body lifted from the live definition at apply time).';
