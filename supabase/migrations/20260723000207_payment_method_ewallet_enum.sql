-- 20260723000207_payment_method_ewallet_enum.sql
-- ADR-006 déc. 9 (payment methods enrichis, lot B) — e-wallets individuels.
-- Arbitrages Mamat 2026-07-23 : GoPay/OVO/DANA deviennent des valeurs de
-- l'enum payment_method (source unique = Postgres) ; comptabilité et
-- réconciliation shift les traitent comme le bucket QRIS (migrations 208-210).
--
-- ADD VALUE est append-only : aucun impact sur les lignes existantes de
-- order_payments / refund_payments / b2b_payments. Les nouvelles valeurs ne
-- sont PAS utilisées dans cette transaction (contrainte Postgres).

ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'gopay';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'ovo';
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'dana';

COMMENT ON TYPE public.payment_method IS
  'Tender types accepted at POS/B2B. gopay/ovo/dana (lot B, ADR-006 déc. 9) '
  'settle like QRIS: JE mapping SALE_PAYMENT_QRIS, close-shift bucket QRIS.';
