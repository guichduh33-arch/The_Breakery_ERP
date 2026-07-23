-- 20260723000211_set_setting_v6_ewallet_allowlist.sql
-- ADR-006 déc. 9 (lot B) — set_setting_v6 : l'allowlist de la branche
-- enabled_payment_methods accepte gopay/ovo/dana (sinon le BO ne peut pas
-- activer les e-wallets ajoutés à l'enum en _207).
--
-- Pattern « bump depuis le corps live » exécuté littéralement (cf. _210) :
-- corps de v5 (27 KB) lu via pg_get_functiondef à l'apply, renommé v6,
-- allowlist étendue par replace() chirurgical gardé, puis EXECUTE.
-- Versioning monotone : v5 droppée dans la même migration.
-- get_settings_by_category_v4 n'est PAS bumpée : sa branche payments relit
-- la colonne telle quelle, aucune liste hardcodée.

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$('cash','card','qris','edc','transfer','store_credit')$q$;
BEGIN
  src := pg_get_functiondef('set_setting_v5(text,jsonb,text)'::regprocedure);

  IF position('public.set_setting_v5(p_key text' IN src) = 0 THEN
    RAISE EXCEPTION 'set_setting_v5 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.set_setting_v5(p_key text',
                      'public.set_setting_v6(p_key text');

  -- L'allowlist n'existe qu'une fois (branche enabled_payment_methods).
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one payment-method allowlist in set_setting_v5 — live body drifted, abort';
  END IF;
  src := replace(src, needle,
                 $q$('cash','card','qris','edc','transfer','store_credit','gopay','ovo','dana')$q$);

  EXECUTE src;
END
$do$;

-- Versioning monotone : v5 droppée dans la même migration.
DROP FUNCTION public.set_setting_v5(text, jsonb, text);

-- Grants — miroir de v5 (_197).
REVOKE EXECUTE ON FUNCTION public.set_setting_v6(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v6(text, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v6(text, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_setting_v6(text, jsonb, text) IS
  'Bump of set_setting_v5 (lot B ADR-006 déc. 9): the enabled_payment_methods '
  'allowlist accepts gopay/ovo/dana. Every other key branch is byte-identical '
  'to v5 (body lifted from the live definition at apply time).';
