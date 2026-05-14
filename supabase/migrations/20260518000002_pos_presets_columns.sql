-- 20260518000002_pos_presets_columns.sql
-- Session 14 / Phase 2.D — POS preset columns on business_config singleton.
--
-- Reviewer follow-up #18 : POSSettingsPage was rendering editable UI for
-- three preset groups whose values were hardcoded constants. Persistence
-- requires three new JSONB columns on business_config so the existing
-- get_settings_by_category_v1 / set_setting_v1 RPC pair can broker reads
-- and writes. Per-element validation is deferred to the RPC (see migration
-- 20260518000003_extend_settings_rpcs_for_pos_presets.sql) so this file
-- only enforces the array shape at the column level.

ALTER TABLE business_config
  ADD COLUMN pos_quick_payment_amounts JSONB NOT NULL
    DEFAULT '[50000,100000,150000,200000,500000]'::jsonb;

ALTER TABLE business_config
  ADD COLUMN pos_opening_cash_presets JSONB NOT NULL
    DEFAULT '[100000,200000,300000,500000,1000000]'::jsonb;

ALTER TABLE business_config
  ADD COLUMN pos_discount_presets JSONB NOT NULL
    DEFAULT '[{"value":5,"name":"5%"},{"value":10,"name":"10%"},{"value":15,"name":"15%"},{"value":20,"name":"20%"},{"value":25,"name":"25%"},{"value":50,"name":"Staff Meal"}]'::jsonb;

-- Shape constraints — array typeof enforced at write time. The RPC layer
-- enforces per-element validation (positive numbers ; {value, name}
-- objects). Keeping the CHECK constraints permissive here lets us evolve
-- discount preset element shape without re-baselining the column.
ALTER TABLE business_config
  ADD CONSTRAINT business_config_pos_quick_payment_amounts_is_array
    CHECK (jsonb_typeof(pos_quick_payment_amounts) = 'array');

ALTER TABLE business_config
  ADD CONSTRAINT business_config_pos_opening_cash_presets_is_array
    CHECK (jsonb_typeof(pos_opening_cash_presets) = 'array');

ALTER TABLE business_config
  ADD CONSTRAINT business_config_pos_discount_presets_is_array
    CHECK (jsonb_typeof(pos_discount_presets) = 'array');

COMMENT ON COLUMN business_config.pos_quick_payment_amounts IS
  'Session 14 / Phase 2.D. JSONB array of positive integers (IDR cents). Powers the cash-tender quick-amount buttons in PaymentTerminal. Edited via set_setting_v1(p_key=pos_quick_payment_amounts, p_category=pos_presets).';

COMMENT ON COLUMN business_config.pos_opening_cash_presets IS
  'Session 14 / Phase 2.D. JSONB array of positive integers (IDR cents). Powers the quick-amount grid in OpenShiftModal step 2 (cash). Edited via set_setting_v1(p_key=pos_opening_cash_presets, p_category=pos_presets).';

COMMENT ON COLUMN business_config.pos_discount_presets IS
  'Session 14 / Phase 2.D. JSONB array of objects { value: 0..100, name: non-empty string }. Persisted via set_setting_v1(p_key=pos_discount_presets, p_category=pos_presets). Discount-modal consumer wiring lands in a follow-up — currently displayed in POSSettingsPage only.';
