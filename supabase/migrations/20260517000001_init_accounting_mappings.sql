-- 20260517000001_init_accounting_mappings.sql
-- Session 13 / Phase 1.A / migration 10-A0 :
--   accounting_mappings (mapping_key TEXT PK → accounts.code) + seed 24 mapping keys
--   + helper resolve_mapping_account(p_mapping_key TEXT) RETURNS UUID SECURITY DEFINER
--
-- Why : trigger code currently hardcodes account codes ('1110', '4100', '2110' etc.).
-- Any COA reshuffle breaks JE creation silently. The mapping table is single source
-- of truth — triggers/RPCs resolve via mapping key, never via literal code.
--
-- Decision : D11 (Decision Pack 2026-05-13) — table + 24 keys + helper land Phase 1.A.
-- Verified V3-absent via `grep -R accounting_mappings supabase/` → 0 hit (2026-05-14).

CREATE TABLE accounting_mappings (
  mapping_key   TEXT PRIMARY KEY,
  account_code  TEXT NOT NULL REFERENCES accounts(code),
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounting_mappings_account_code ON accounting_mappings(account_code);

CREATE TRIGGER accounting_mappings_set_updated_at
  BEFORE UPDATE ON accounting_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE accounting_mappings IS
  'Single source of truth mapping symbolic JE keys (e.g. SALE_POS_REVENUE) to '
  'accounts.code (e.g. 4100). Triggers and RPCs resolve via resolve_mapping_account() — '
  'never hardcode account codes. D11 (Decision Pack 2026-05-13).';

-- Seed 24 initial mapping keys (Decision D11). Some account codes (1141, 5110, etc.)
-- are introduced in migration 20260517000005_seed_full_coa_sak_emkm.sql — but the FK is
-- on accounts(code) which exists at this point; the seed below is split: codes already
-- present in V3 (1110, 4100, 2110, 2210, 4900) seeded here ; codes added in 000005 are
-- seeded inside that migration. This file seeds only mappings whose account_code is
-- already populated.
INSERT INTO accounting_mappings (mapping_key, account_code, description) VALUES
  ('SALE_PAYMENT_CASH',           '1110', 'Sale payment via cash → DR Cash on Hand'),
  ('SALE_POS_REVENUE',            '4100', 'POS sale revenue → CR Sales Revenue'),
  ('SALE_PB1_TAX',                '2110', 'PB1 (10%) restaurant tax payable → CR PB1 Payable'),
  ('SALE_DISCOUNT',               '4900', 'Sales discount (loyalty / promo) → DR Sales Discounts'),
  ('LOYALTY_LIABILITY',           '2210', 'Loyalty points liability → CR Loyalty Liability')
;

-- Helper : resolve_mapping_account(p_mapping_key TEXT) → UUID
-- SECURITY DEFINER so triggers (running as table owner) can use it.
-- RAISEs 'mapping_key_unknown' (P0002) if not found or inactive.
CREATE OR REPLACE FUNCTION resolve_mapping_account(p_mapping_key TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_code       TEXT;
BEGIN
  IF p_mapping_key IS NULL OR length(trim(p_mapping_key)) = 0 THEN
    RAISE EXCEPTION 'mapping_key_required' USING ERRCODE = 'P0002';
  END IF;

  SELECT am.account_code, a.id
    INTO v_code, v_account_id
    FROM accounting_mappings am
    JOIN accounts a ON a.code = am.account_code
    WHERE am.mapping_key = p_mapping_key
      AND am.is_active = true
      AND a.is_active = true
      AND a.deleted_at IS NULL;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'mapping_key_unknown: %', p_mapping_key
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_account_id;
END;
$$;

COMMENT ON FUNCTION resolve_mapping_account(TEXT) IS
  'D11 helper. Resolves a symbolic JE mapping key to an accounts.id. '
  'Used by every JE trigger / RPC instead of literal account codes. '
  'RAISEs mapping_key_unknown (P0002) when missing or inactive.';

-- RLS : read-only for authenticated (introspection), writes via SECURITY DEFINER
ALTER TABLE accounting_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON accounting_mappings FOR SELECT
  USING (is_authenticated());

REVOKE EXECUTE ON FUNCTION resolve_mapping_account(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_mapping_account(TEXT) TO authenticated;
