-- 20260710000089_promotions_usage_caps_columns.sql
-- S57 P2.1 (Chantier A-D4) — usage cap columns on promotions.
-- NULL = illimité. Counting source is the append-only promotion_applications
-- table JOINed to orders (non-voided) — no denormalized counter (A-D4/A-D7).
-- Enforced advisory in evaluate_promotions_v2 (_091) and hard-gated atomically
-- in complete_order_with_payment_v17 (_092).

ALTER TABLE promotions
  ADD COLUMN max_uses INT NULL,
  ADD COLUMN max_uses_per_customer INT NULL;

ALTER TABLE promotions
  ADD CONSTRAINT promotions_max_uses_positive
    CHECK (max_uses IS NULL OR max_uses > 0),
  ADD CONSTRAINT promotions_max_uses_per_customer_positive
    CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0);

COMMENT ON COLUMN promotions.max_uses IS
  'S57 A-D4 — global usage cap (NULL = illimité). Compté sur promotion_applications '
  'JOIN orders WHERE voided_at IS NULL. Advisory dans evaluate_promotions_v2, '
  'gate dur (pg_advisory_xact_lock + re-count) dans complete_order_with_payment_v17.';
COMMENT ON COLUMN promotions.max_uses_per_customer IS
  'S57 A-D4 — per-customer usage cap (NULL = illimité). Commande sans customer_id '
  '(anonyme) → cap per-customer non applicable, le cap global reste appliqué (A-D6).';
