-- 20260723000214_get_settings_by_category_v5_fees.sql
-- ADR-006 déc. 9 (lot C) — get_settings_by_category_v5 : la catégorie
-- `payments` expose aussi `payment_method_fees` (la v4 construit un
-- jsonb_build_object par catégorie, la nouvelle clé exige donc un bump).
--
-- Pattern « bump depuis le corps live » (cf. _210/_211/_213) : corps de v4 lu
-- via pg_get_functiondef à l'apply, renommé v5, clé ajoutée par replace()
-- chirurgical gardé, puis EXECUTE. Versioning monotone : v4 droppée ici.

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$'enabled_payment_methods', v_row.enabled_payment_methods$q$;
BEGIN
  src := pg_get_functiondef('get_settings_by_category_v4(text)'::regprocedure);

  IF position('public.get_settings_by_category_v4(p_category text' IN src) = 0 THEN
    RAISE EXCEPTION 'get_settings_by_category_v4 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.get_settings_by_category_v4(p_category text',
                      'public.get_settings_by_category_v5(p_category text');

  -- La clé n'existe qu'une fois (branche payments).
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one enabled_payment_methods key in get_settings_by_category_v4 — live body drifted, abort';
  END IF;
  src := replace(src, needle,
                 $q$'enabled_payment_methods', v_row.enabled_payment_methods,
        'payment_method_fees',     v_row.payment_method_fees$q$);

  EXECUTE src;
END
$do$;

-- Versioning monotone : v4 droppée dans la même migration.
DROP FUNCTION public.get_settings_by_category_v4(text);

-- Grants — miroir de v4 (_197).
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v5(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v5(text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v5(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_settings_by_category_v5(text) IS
  'Bump of get_settings_by_category_v4 (lot C ADR-006 dec. 9): the payments '
  'category also returns payment_method_fees. Every other category branch is '
  'byte-identical to v4 (body lifted from the live definition at apply time).';
