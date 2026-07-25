-- ADR-013 Lot 1 — Correction comptable du JE de refund (fn_create_je_for_refund)
--
-- D2  : un refund issu d'un VOID (is_full_void = true) ne doit PAS émettre de JE
--       'sale_refund'. La contre-passation est déjà produite par le trigger
--       create_sale_journal_entry (JE 'sale_void'), seule et unique reversal.
--       => RETURN NEW en tête si NEW.is_full_void.
--
-- D3a : DEUX défauts cumulés.
--   (i)  Le CASE testait 'debit_card'/'credit_card', valeurs ABSENTES de l'enum
--        payment_method réel (cash|card|qris|edc|transfer|store_credit|gopay|
--        ovo|dana). => CASE réaligné à l'identique sur le JE de vente.
--   (ii) TIMING : le trigger était AFTER INSERT ON refunds (non déférable), or
--        refund_order_rpc insère la ligne `refunds` PUIS les `refund_payments`
--        (FK oblige : refund_payments.refund_id -> refunds.id). Au tir du trigger,
--        refund_payments est vide -> fallback `SALE_PAYMENT_CASH` systématique.
--        Preuve live : 76/76 JE sale_refund historiques crédités 1110 Cash, le
--        CASE par tender n'a JAMAIS tourné. Or la RPC valide les refunds PAR
--        méthode (plafonds par canal) : l'intention est un remboursement par
--        canal de règlement, contredit par le GL tout-Caisse.
--        => Trigger converti en CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED :
--        il tire au COMMIT, refund_payments déjà peuplé, le CASE s'exécute.
--   store_credit reste temporairement sur SALE_PAYMENT_CASH jusqu'au Lot 4
--   (compte 2220 Avoir client + symétrie D3b).
--
-- ADR-013 D3 révisé (voir addendum) : le fix D3a n'est pas le seul CASE mais le
-- timing du trigger. Décision Option 1 (trigger déféré) validée par Mamat.
--
-- Trigger function -> CREATE OR REPLACE en place (pas un RPC versionné publié).
-- Départ = corps live pg_get_functiondef ; seuls le guard D2 et le CASE changent.

CREATE OR REPLACE FUNCTION public.fn_create_je_for_refund()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_je_id        UUID;
  v_existing     UUID;
  v_entry_no     TEXT;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_net          DECIMAL(14,2);
  v_pay          RECORD;
  v_order_number TEXT;
  v_cash_id      UUID;
  v_mapping_key  TEXT;
BEGIN
  -- D2 : refund de void -> la contre-passation est le JE 'sale_void' émis par
  -- create_sale_journal_entry. Ne pas produire de second JE 'sale_refund'.
  IF NEW.is_full_void THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'sale_refund' AND reference_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN NEW; END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_net := NEW.total - NEW.tax_refunded;
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  SELECT order_number INTO v_order_number FROM orders WHERE id = NEW.order_id;

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
  VALUES (v_entry_no, NEW.created_at::date,
          'Refund ' || NEW.refund_number || ' (order ' || COALESCE(v_order_number, '?') || ')',
          'sale_refund', NEW.id, 'posted', NEW.total, NEW.total, NEW.refunded_by)
  RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, v_net,            0, 'Sales revenue (refund)'),
    (v_je_id, v_pb1_id,   NEW.tax_refunded, 0, 'PB1 payable (refund)');

  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
    -- D3a : mapping aligné sur l'enum réel et sur le JE de vente.
    v_mapping_key := CASE v_pay.method::TEXT
      WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
      WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
      WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
      WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
      WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
      WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'  -- Lot 4 : -> 2220 (avoir client)
      -- e-wallets réglés comme QRIS (décision 2026-07-23)
      WHEN 'gopay'        THEN 'SALE_PAYMENT_QRIS'
      WHEN 'ovo'          THEN 'SALE_PAYMENT_QRIS'
      WHEN 'dana'         THEN 'SALE_PAYMENT_QRIS'
      ELSE 'SALE_PAYMENT_CASH'
    END;
    v_cash_id := resolve_mapping_account(v_mapping_key);
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, v_pay.amount,
      'Cash refund (' || v_pay.method::TEXT || ')');
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM refund_payments WHERE refund_id = NEW.id) THEN
    v_cash_id := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, NEW.total, 'Cash refund (fallback — no tender recorded)');
  END IF;

  RETURN NEW;
END $function$;

-- D3a (ii) : trigger déféré au COMMIT pour que refund_payments soit peuplé
-- lorsque le JE est construit (le CASE par tender devient effectif).
DROP TRIGGER IF EXISTS trg_create_je_for_refund ON public.refunds;
CREATE CONSTRAINT TRIGGER trg_create_je_for_refund
  AFTER INSERT ON public.refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_je_for_refund();
