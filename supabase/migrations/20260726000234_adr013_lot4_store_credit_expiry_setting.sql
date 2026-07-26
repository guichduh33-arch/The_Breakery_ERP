-- ADR-013 Lot 4 (D7) — expiration configurable des avoirs client.
--
-- business_config.store_credit_expiry_months : 0 = jamais (défaut, arbitrage
-- Mamat 2026-07-26), 1..120 = durée de vie en mois posée sur chaque crédit émis
-- (grant / conversion / refund-en-avoir). Le job expire_store_credit_v1 (_236)
-- skip si 0.
--
-- Pattern « bump depuis le corps live » (recette _220) : set_setting_v9 → v10
-- (branche greffée après le bloc pin_lockout_minutes), get_settings_by_category_v7
-- → v8 (clé ajoutée à la catégorie payments). Versioning monotone : v9/v7
-- droppées ici.

ALTER TABLE business_config
  ADD COLUMN store_credit_expiry_months INTEGER NOT NULL DEFAULT 0
    CONSTRAINT business_config_sc_expiry_months_range CHECK (store_credit_expiry_months BETWEEN 0 AND 120);

DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$      SELECT to_jsonb(pin_lockout_minutes) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pin_lockout_minutes = (p_value #>> '{}')::INTEGER, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
  graft TEXT := $q$      SELECT to_jsonb(pin_lockout_minutes) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pin_lockout_minutes = (p_value #>> '{}')::INTEGER, updated_at = now() WHERE id = 1;
      v_new := p_value;

    -- ADR-013 Lot 4 (D7) : expiration des avoirs client (0 = jamais).
    WHEN 'store_credit_expiry_months' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'store_credit_expiry_months expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC <> floor((p_value #>> '{}')::NUMERIC)
         OR (p_value #>> '{}')::NUMERIC < 0
         OR (p_value #>> '{}')::NUMERIC > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'store_credit_expiry_months must be an integer in [0, 120] (0 = never)';
      END IF;
      SELECT to_jsonb(store_credit_expiry_months) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET store_credit_expiry_months = (p_value #>> '{}')::INTEGER, updated_at = now() WHERE id = 1;
      v_new := p_value;$q$;
BEGIN
  src := pg_get_functiondef('set_setting_v9(text,jsonb,text)'::regprocedure);

  IF position('public.set_setting_v9(p_key text' IN src) = 0 THEN
    RAISE EXCEPTION 'set_setting_v9 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.set_setting_v9(p_key text',
                      'public.set_setting_v10(p_key text');

  -- Le bloc d'écriture pin_lockout_minutes n'existe qu'une fois.
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one pin_lockout_minutes write block in set_setting_v9 — live body drifted, abort';
  END IF;
  src := replace(src, needle, graft);

  EXECUTE src;
END
$do$;

DROP FUNCTION public.set_setting_v9(text, jsonb, text);

REVOKE EXECUTE ON FUNCTION public.set_setting_v10(text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v10(text, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_setting_v10(text, jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_setting_v10(text, jsonb, text) IS
  'Bump of set_setting_v9 (ADR-013 Lot 4, D7): new key store_credit_expiry_months '
  '[0,120], 0 = never (category payments). Every other key branch is '
  'byte-identical to v9 (body lifted from the live definition at apply time).';

-- get_settings_by_category : la clé rejoint la catégorie payments.
DO $do$
DECLARE
  src TEXT;
  needle TEXT := $q$      WHEN 'payments' THEN jsonb_build_object(
        'enabled_payment_methods', v_row.enabled_payment_methods,
        'payment_method_fees',     v_row.payment_method_fees
      )$q$;
BEGIN
  src := pg_get_functiondef('get_settings_by_category_v7(text)'::regprocedure);

  IF position('public.get_settings_by_category_v7(p_category text' IN src) = 0 THEN
    RAISE EXCEPTION 'get_settings_by_category_v7 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.get_settings_by_category_v7(p_category text',
                      'public.get_settings_by_category_v8(p_category text');

  -- La branche payments n'existe qu'une fois.
  IF (length(src) - length(replace(src, needle, ''))) <> length(needle) THEN
    RAISE EXCEPTION 'expected exactly one payments branch in get_settings_by_category_v7 — live body drifted, abort';
  END IF;
  src := replace(src, needle,
                 $q$      WHEN 'payments' THEN jsonb_build_object(
        'enabled_payment_methods',    v_row.enabled_payment_methods,
        'payment_method_fees',        v_row.payment_method_fees,
        'store_credit_expiry_months', v_row.store_credit_expiry_months
      )$q$);

  EXECUTE src;
END
$do$;

DROP FUNCTION public.get_settings_by_category_v7(text);

REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v8(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v8(text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v8(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_settings_by_category_v8(text) IS
  'Bump of get_settings_by_category_v7 (ADR-013 Lot 4, D7): payments category '
  'gains store_credit_expiry_months. Every other category branch is '
  'byte-identical to v7 (body lifted from the live definition at apply time).';
