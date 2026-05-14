-- 20260517000110_init_purchase_orders.sql
-- Session 13 / Phase 3.A — Purchasing PO workflow : tables, sequences, RLS,
-- permissions, indexes.
--
-- Module 7 (Purchasing & Suppliers). Implements the Purchase Order lifecycle:
--   draft → pending → partial → received → cancelled
--
-- Three tables:
--   1. purchase_orders        — header (one PO)
--   2. purchase_order_items   — line items (1..N per PO)
--   3. goods_receipt_notes    — receipt event (1..N per PO, partial OK)
--
-- The goods_receipt_notes row INSERT will fire the existing
-- create_purchase_journal_entry() trigger (Phase 1.A migration 000011),
-- attached in migration 000113. The trigger reads NEW.{subtotal, vat_amount,
-- total, payment_terms, received_date, received_by, grn_number} — these
-- columns are wired below.
--
-- Decisions:
--   - D-W3-3A-01 : permissions split per action (purchasing.po.create /
--     receive / cancel / read) instead of a single `purchasing.po.manage`.
--   - D-W3-3A-02 : GRN mirrors create_purchase_journal_entry contract
--     (subtotal/total/payment_terms/received_date).
--   - D-W3-3A-03 : movement_type 'purchase' on goods receipt.
--   - RLS: authenticated SELECT via has_permission('purchasing.po.read');
--     INSERT/UPDATE/DELETE revoked → writes via SECURITY DEFINER RPCs only.
--   - NEVER re-CREATE has_permission() — only INSERT permission rows.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Sequences for human-readable PO and GRN numbers.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS purchase_orders_seq;
CREATE SEQUENCE IF NOT EXISTS goods_receipt_notes_seq;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. purchase_orders header table.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE purchase_orders (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number       TEXT            NOT NULL UNIQUE,
  supplier_id     UUID            NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status          TEXT            NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('draft','pending','partial','received','cancelled')),
  payment_terms   TEXT            NOT NULL DEFAULT 'credit'
                                  CHECK (payment_terms IN ('cash','credit')),
  subtotal        DECIMAL(14,2)   NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  vat_amount      DECIMAL(14,2)   NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount    DECIMAL(14,2)   NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  order_date      DATE            NOT NULL DEFAULT current_date,
  expected_date   DATE,
  received_date   DATE,
  notes           TEXT,
  cancel_reason   TEXT,
  metadata        JSONB           NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key UUID            UNIQUE,
  created_by      UUID            REFERENCES user_profiles(id) ON DELETE SET NULL,
  received_by     UUID            REFERENCES user_profiles(id) ON DELETE SET NULL,
  cancelled_by    UUID            REFERENCES user_profiles(id) ON DELETE SET NULL,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_purchase_orders_supplier   ON purchase_orders(supplier_id)  WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_orders_status     ON purchase_orders(status)       WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_orders_order_date ON purchase_orders(order_date)   WHERE deleted_at IS NULL;
CREATE INDEX idx_purchase_orders_created_at ON purchase_orders(created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER purchase_orders_set_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE purchase_orders IS
  'Session 13 — Module 7. Purchase Order header. Status lifecycle: '
  'draft → pending → partial → received → cancelled. Writes via SECURITY '
  'DEFINER RPCs (create_purchase_order_v1, receive_purchase_order_v1, '
  'cancel_purchase_order_v1). total_amount = subtotal + vat_amount.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. purchase_order_items line items.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE purchase_order_items (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id               UUID            NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id          UUID            NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity            DECIMAL(14,3)   NOT NULL CHECK (quantity > 0),
  received_quantity   DECIMAL(14,3)   NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit                TEXT            NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 16),
  unit_cost           DECIMAL(14,2)   NOT NULL CHECK (unit_cost >= 0),
  subtotal            DECIMAL(14,2)   GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  notes               TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT purchase_order_items_received_lte_quantity
    CHECK (received_quantity <= quantity)
);

CREATE INDEX idx_purchase_order_items_po       ON purchase_order_items(po_id);
CREATE INDEX idx_purchase_order_items_product  ON purchase_order_items(product_id);

CREATE TRIGGER purchase_order_items_set_updated_at
  BEFORE UPDATE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE purchase_order_items IS
  'Session 13 — Module 7. PO line items. received_quantity accumulates across '
  'multiple goods_receipt_notes. The generated `subtotal` column is the ordered '
  'line value (quantity * unit_cost), not the received value.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. goods_receipt_notes — one INSERT per partial/full receipt event.
--
-- Columns mirror the create_purchase_journal_entry() trigger contract
-- (Phase 1.A migration 000011) so the trigger can read NEW.* directly.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE goods_receipt_notes (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number      TEXT            NOT NULL UNIQUE,
  po_id           UUID            NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  received_by     UUID            REFERENCES user_profiles(id) ON DELETE SET NULL,
  received_date   DATE            NOT NULL DEFAULT current_date,
  payment_terms   TEXT            NOT NULL DEFAULT 'credit'
                                  CHECK (payment_terms IN ('cash','credit')),
  subtotal        DECIMAL(14,2)   NOT NULL CHECK (subtotal >= 0),
  vat_amount      DECIMAL(14,2)   NOT NULL CHECK (vat_amount >= 0),
  total           DECIMAL(14,2)   NOT NULL CHECK (total >= 0),
  notes           TEXT,
  metadata        JSONB           NOT NULL DEFAULT '{}'::JSONB,
  idempotency_key UUID            UNIQUE,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_grn_po           ON goods_receipt_notes(po_id);
CREATE INDEX idx_grn_received_at  ON goods_receipt_notes(created_at DESC);

COMMENT ON TABLE goods_receipt_notes IS
  'Session 13 — Module 7. Goods Receipt Note. ONE row per receive event. '
  'Trigger create_purchase_journal_entry (attached in 000113) emits the JE '
  'DR INVENTORY_GENERAL (subtotal) + DR PURCHASE_VAT_INPUT (vat_amount) = '
  'CR PURCHASE_PAYABLE/PURCHASE_CASH_OUT (total) at INSERT time.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Row Level Security : SELECT via has_permission('purchasing.po.read');
--    writes go through SECURITY DEFINER RPCs only.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_notes   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON purchase_orders FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'purchasing.po.read'));

CREATE POLICY "perm_read" ON purchase_order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = purchase_order_items.po_id
        AND has_permission(auth.uid(), 'purchasing.po.read')
    )
  );

CREATE POLICY "perm_read" ON goods_receipt_notes FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'purchasing.po.read'));

REVOKE INSERT, UPDATE, DELETE ON purchase_orders      FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON purchase_order_items FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON goods_receipt_notes  FROM authenticated, anon;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Permissions catalogue : INSERT-only (NO has_permission() re-CREATE).
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO permissions (code, module, action, description) VALUES
  ('purchasing.po.read',    'purchasing', 'read',   'View purchase orders and GRNs'),
  ('purchasing.po.create',  'purchasing', 'create', 'Create purchase orders'),
  ('purchasing.po.receive', 'purchasing', 'update', 'Receive goods against a purchase order'),
  ('purchasing.po.cancel',  'purchasing', 'delete', 'Cancel a purchase order')
ON CONFLICT (code) DO NOTHING;

-- Grant to roles. SUPER_ADMIN + ADMIN + MANAGER get all 4 actions.
-- CASHIER and waiter get read-only (visibility but no writes).
INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'purchasing.po.read',    TRUE),
  ('SUPER_ADMIN', 'purchasing.po.create',  TRUE),
  ('SUPER_ADMIN', 'purchasing.po.receive', TRUE),
  ('SUPER_ADMIN', 'purchasing.po.cancel',  TRUE),
  ('ADMIN',       'purchasing.po.read',    TRUE),
  ('ADMIN',       'purchasing.po.create',  TRUE),
  ('ADMIN',       'purchasing.po.receive', TRUE),
  ('ADMIN',       'purchasing.po.cancel',  TRUE),
  ('MANAGER',     'purchasing.po.read',    TRUE),
  ('MANAGER',     'purchasing.po.create',  TRUE),
  ('MANAGER',     'purchasing.po.receive', TRUE),
  ('MANAGER',     'purchasing.po.cancel',  TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;
