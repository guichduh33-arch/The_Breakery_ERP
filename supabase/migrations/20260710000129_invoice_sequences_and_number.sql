-- 20260710000129_invoice_sequences_and_number.sql
-- S68 — Facture PDF B2B : série de numérotation dédiée annuelle continue.
-- Table invoice_sequences (keyée par année) + colonne orders.invoice_number
-- (index unique partiel) + helper interne _next_b2b_invoice_number_v1().

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  year        INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
-- Écrite uniquement par RPC SECURITY DEFINER ; aucun grant direct (miroir order_sequences).
REVOKE ALL ON TABLE public.invoice_sequences FROM PUBLIC;
REVOKE ALL ON TABLE public.invoice_sequences FROM anon;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_key
  ON public.orders (invoice_number) WHERE invoice_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public._next_b2b_invoice_number_v1()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::int;
  v_n    INTEGER;
BEGIN
  INSERT INTO invoice_sequences (year, last_number)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE
      SET last_number = invoice_sequences.last_number + 1
    RETURNING last_number INTO v_n;
  RETURN 'INV/' || v_year::text || '/' || LPAD(v_n::text, 5, '0');
END $function$;

REVOKE ALL ON FUNCTION public._next_b2b_invoice_number_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._next_b2b_invoice_number_v1() FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
