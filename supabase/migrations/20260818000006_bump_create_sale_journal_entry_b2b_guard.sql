-- 20260818000006_bump_create_sale_journal_entry_b2b_guard.sql
--
-- Bug confirmé sur dev (revenu doublé, 10 commandes) : les commandes B2B du
-- flux AR (créées par create_b2b_order_v6, order_type='b2b', statut initial
-- 'b2b_pending') portent déjà leur JE de revenu — reference_type='b2b_order',
-- DR 1132 (B2B_AR) / CR 4131 (SALE_B2B_REVENUE) — émise dans la transaction de
-- création. Quand record_b2b_payment_v2 les fait passer à 'paid', elles n'ont
-- SANS EXCEPTION aucune ligne order_payments (le règlement B2B vit dans
-- b2b_payments, pas order_payments) : ce trigger AFTER UPDATE OF status sur
-- orders retombait alors dans le fallback cash et émettait une SECONDE JE de
-- revenu (reference_type='sale', CR 4100) + un DR 1110 fantôme. Côté void, il
-- n'existe PAS de double-JE symétrique : cancel_b2b_order_v1 exige
-- status='b2b_pending' en entrée (jamais 'paid'), donc la branche void de ce
-- trigger (qui ne s'active que si OLD.status IN ('paid','completed')) n'a
-- jamais pu s'activer pour une annulation B2B — aucune JE fantôme côté void
-- n'a jamais existé. Le bénéfice réel de la garde sur cette branche est
-- différent : sans elle, toute transition de statut d'une commande B2B vers
-- 'paid'/'voided' passait par check_fiscal_period_open(NEW.created_at::date),
-- qui peut lever P0004 pour une commande B2B ANCIENNE dont la période de
-- CRÉATION est fermée — alors que les RPC B2B (create/record_payment/cancel)
-- portent leur propre garde fiscale sur now(), pas sur la date de création.
-- La garde ci-dessous couvre donc les deux branches par principe de symétrie
-- ET lève ce blocage fiscal potentiel côté B2B — ce n'est pas la correction
-- d'un second double-JE void, qui n'a jamais existé.
--
-- Correctif (arbitré par Mamat) : une garde en tête du trigger, placée APRÈS
-- le filtre is_historical_import / NOT IN ('paid','voided') et AVANT
-- check_fiscal_period_open — les fonctions B2B portent leurs propres gardes
-- fiscales, une commande B2B ne doit être ni bloquée ni comptabilisée par ce
-- trigger. Double condition pour couvrir aussi bien la commande B2B ordinaire
-- (order_type='b2b') que toute commande dont l'AR a déjà été comptabilisée
-- par ailleurs (filet EXISTS sur journal_entries.reference_type='b2b_order').
--
-- Corps ci-dessous = relevé pg_get_functiondef du 2026-08-17 sur dev V3,
-- verbatim, plus la garde. Aucune autre ligne modifiée. Pas de changement de
-- signature (RETURNS trigger, zéro argument) : pas de DROP, ACL live déjà
-- restreinte (fonction non client-callable, appelée uniquement par les
-- triggers trg_create_sale_journal_entry_ins/upd sur orders).

CREATE OR REPLACE FUNCTION public.create_sale_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rate      NUMERIC;
  v_vat       DECIMAL(14,2);
  v_net       DECIMAL(14,2);
  v_je_id     UUID;
  v_existing  UUID;
  v_entry_no  TEXT;
  v_sales_id  UUID;
  v_pb1_id    UUID;
  v_pay       RECORD;
  v_acc_id    UUID;
BEGIN
  IF NEW.is_historical_import THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  -- B2B guard: revenue for B2B orders is carried by the 'b2b_order' JE
  -- (DR 1132 / CR 4131) emitted by create_b2b_order at creation time, and
  -- reversed/adjusted by cancel_b2b_order's own books. record_b2b_payment
  -- flips status to 'paid' WITHOUT any order_payments row, which would
  -- otherwise trip the no-payments fallback below and double the revenue.
  -- This trigger must not emit or block anything for a B2B order.
  IF NEW.order_type = 'b2b'
     OR EXISTS (SELECT 1 FROM journal_entries
                  WHERE reference_type = 'b2b_order' AND reference_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_rate     := current_pb1_rate();
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := COALESCE(NEW.tax_amount, 0);
    v_net := NEW.total - v_vat;

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'Sale ' || NEW.order_number, 'sale', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, 0, v_net, 'Sales revenue (net of PB1)');

    IF v_vat > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_pb1_id, 0, v_vat, 'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');
    END IF;

    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, v_pay.amount, 0,
          'Payment receipt (' || v_pay.method || ')');
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, NEW.total, 0,
          'Payment receipt (no order_payments rows — fallback to cash)');
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'sale'));
    END IF;

  ELSIF NEW.status = 'voided' AND OLD.status IN ('paid', 'completed') THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_vat := COALESCE(NEW.tax_amount, 0);
    v_net := NEW.total - v_vat;

    v_entry_no := next_journal_entry_number(NEW.created_at::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, NEW.created_at::date,
      'REVERSAL ' || NEW.order_number, 'sale_void', NEW.id,
      'posted', NEW.total, NEW.total, NEW.served_by
    ) RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_sales_id, v_net, 0, 'Sales revenue (reversal)');

    IF v_vat > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_pb1_id, v_vat, 0, 'PB1 payable (reversal)');
    END IF;

    FOR v_pay IN
      SELECT method::TEXT AS method, amount
        FROM order_payments
        WHERE order_id = NEW.id
        ORDER BY paid_at ASC
    LOOP
      v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, 0, v_pay.amount,
          'Payment reversal (' || v_pay.method || ')');
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = NEW.id) THEN
      v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (v_je_id, v_acc_id, 0, NEW.total,
          'Payment reversal (no order_payments rows — fallback to cash)');
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
        VALUES (NEW.served_by, 'je.payment_fallback_cash', 'orders', NEW.id,
                jsonb_build_object('order_number', NEW.order_number, 'total', NEW.total,
                                   'direction', 'reversal'));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.create_sale_journal_entry() IS
  'Trigger fn (AFTER INSERT/UPDATE OF status on orders). B2B guard added 2026-08-18: order_type=''b2b'' OR an existing journal_entries.reference_type=''b2b_order'' row short-circuits to RETURN NEW before the fiscal guard — B2B revenue is booked by create_b2b_order/cancel_b2b_order, never by this trigger. Fixes a confirmed double-revenue bug (record_b2b_payment flips status to paid with zero order_payments rows, which used to trip the no-payments cash fallback).';
