-- ADR-013 Lot 4 — journal_entries.reference_type : le CHECK live (étendu en
-- dernier par _080) n'admet pas les nouveaux types du socle avoir client.
-- Ajout de : store_credit_grant (JE du grant manager, _235),
-- store_credit_conversion (JE loyalty -> avoir, _235),
-- store_credit_expiry (JE de reprise en produit, _236).
-- Pattern _068/_080 : DROP + ADD avec la liste complète.

ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_reference_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_reference_type_check
  CHECK (reference_type IS NULL OR reference_type = ANY (ARRAY[
    'sale', 'sale_void', 'sale_refund',
    'purchase', 'purchase_return', 'purchase_payment',
    'expense', 'expense_payment',
    'shift_close', 'adjustment', 'waste', 'opname', 'production', 'transfer',
    'manual', 'pos_outstanding', 'pos_outstanding_payment', 'stock_movement',
    'void', 'refund', 'cash_movement',
    'b2b_order', 'b2b_payment', 'b2b_adjustment', 'b2b_order_cancel',
    'year_close',
    -- ADR-013 Lot 4 (avoir client) :
    'store_credit_grant', 'store_credit_conversion', 'store_credit_expiry'
  ]));
