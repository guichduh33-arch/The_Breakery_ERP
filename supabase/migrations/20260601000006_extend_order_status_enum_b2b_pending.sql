-- 20260601000006_extend_order_status_enum_b2b_pending.sql
-- Session 24 / Phase 1.A.1 / migration 2
--
-- Étend order_status avec 'b2b_pending' pour les commandes B2B en attente de
-- paiement. Distinct de 'draft' (brouillon POS) sémantiquement : 'b2b_pending'
-- signifie commande comptabilisée (JE émis DR AR_B2B / CR Sales) mais pas
-- encore encaissée. Le passage à 'paid' se fait via record_b2b_payment_v1
-- (futur S25+ étendra cette transition).

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'b2b_pending';

COMMENT ON TYPE order_status IS
  'States : draft (brouillon POS), paid (encaissé), voided (annulé) ; b2b_pending (B2B en attente paiement, S24).';
