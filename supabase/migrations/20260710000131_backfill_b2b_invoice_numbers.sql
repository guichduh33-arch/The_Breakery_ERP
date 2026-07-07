-- 20260710000131_backfill_b2b_invoice_numbers.sql
-- S68 — Backfill idempotent : attribue un invoice_number à toutes les commandes B2B
-- existantes sans numéro (voided inclus, série complète), par année de created_at,
-- ordre (created_at, id), et seede invoice_sequences.last_number par année.
-- Idempotent : ne touche que invoice_number IS NULL. (Dev = 0 commande B2B → no-op réel.)

DO $$
DECLARE
  r      RECORD;
  v_n    INTEGER;
BEGIN
  FOR r IN
    SELECT id, EXTRACT(YEAR FROM created_at)::int AS yr
      FROM orders
     WHERE order_type = 'b2b' AND invoice_number IS NULL
     ORDER BY created_at, id
  LOOP
    INSERT INTO invoice_sequences (year, last_number)
      VALUES (r.yr, 1)
      ON CONFLICT (year) DO UPDATE
        SET last_number = invoice_sequences.last_number + 1
      RETURNING last_number INTO v_n;
    UPDATE orders
       SET invoice_number = 'INV/' || r.yr::text || '/' || LPAD(v_n::text, 5, '0')
     WHERE id = r.id;
  END LOOP;
END $$;
