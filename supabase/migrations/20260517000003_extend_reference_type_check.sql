-- 20260517000003_extend_reference_type_check.sql
-- Session 13 / Phase 1.A / migration 10-004 :
--   Widen journal_entries.reference_type CHECK from legacy 4-value set
--   ('sale','void','adjustment','manual') to the 17-type SAK-EMKM-compliant set.
--
-- Why : Phase 1.A adds new JE flows (refund, purchase, expense, opname, production,
-- waste, transfer, pos_outstanding). The CHECK must accept the new strings before
-- those triggers can post.
--
-- Decision : D13 (Decision Pack 2026-05-13). Widening a CHECK never breaks existing
-- rows ; V3 has no prod traffic yet so no rewrite needed.

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_reference_type_check;

ALTER TABLE journal_entries
  ADD  CONSTRAINT journal_entries_reference_type_check
  CHECK (reference_type IS NULL OR reference_type IN (
    'sale',
    'sale_void',
    'sale_refund',
    'purchase',
    'purchase_return',
    'purchase_payment',
    'expense',
    'expense_payment',
    'shift_close',
    'adjustment',
    'waste',
    'opname',
    'production',
    'transfer',
    'manual',
    'pos_outstanding',
    'pos_outstanding_payment',
    -- legacy : the V3 init trigger writes 'void' (singular) and 'refund' (singular).
    -- Keep both during transition — Phase 1.A migrations 000010 / 000013 emit the
    -- new canonical values (sale_void / sale_refund). Listing both keeps existing
    -- rows valid post-migration and prevents reset failures on test seeds.
    'void',
    'refund'
  ));

COMMENT ON CONSTRAINT journal_entries_reference_type_check ON journal_entries IS
  'D13: 17 canonical reference_types + 2 legacy aliases (void/refund) tolerated '
  'during V2→V3 transition. New code emits canonical names ; legacy rows stay valid.';
