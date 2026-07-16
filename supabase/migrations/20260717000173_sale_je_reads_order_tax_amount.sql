-- 20260717000173_sale_je_reads_order_tax_amount.sql
-- Lot 6a (3/8) — `create_sale_journal_entry` lit `NEW.tax_amount` au lieu de
-- recalculer la part PB1 depuis `NEW.total`.
--
-- ⚠️ SEULE migration du lot 6a qui N'EST PAS à comportement constant. Lire
--    l'encart « Conséquence B2B » ci-dessous avant tout bump ultérieur.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pourquoi
--
-- Le trigger calculait `v_vat := round_idr(NEW.total * v_rate / (1 + v_rate))`
-- en ignorant `orders.tax_amount` — la valeur canonique produite par le
-- money-path. Deux défauts en découlent :
--
--   (a) Double arrondi. En mode exclusive (`tax_inclusive = false`), le
--       money-path écrit tax = round_idr(items * r) puis total = items + tax.
--       Le trigger, lui, ré-extrait round_idr(total * r/(1+r)) — une base
--       différente, un second round_idr. Les deux peuvent diverger de 100 IDR :
--       la JE serait déséquilibrée en silence. C'est la même classe de bug que
--       F-S26-AC-01 (trigger hardcodant 10/110 pendant que la commande suivait
--       business_config.tax_rate), corrigée à l'époque par `current_pb1_rate()`.
--
--   (b) PB1 fantôme sur les ventes B2B — cf. ci-dessous.
--
-- Lire `NEW.tax_amount` supprime les deux d'un coup : la JE cesse d'avoir un
-- avis sur le mode taxe et recopie ce que la commande porte. Le mode vit
-- désormais dans `_pb1_split_v1` seul (migration _171).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Conséquence B2B — CHANGEMENT DE COMPORTEMENT ASSUMÉ
--
-- `create_b2b_order_v5` écrit tax_amount = 0 : la vente en gros B2B n'est pas
-- assujettie au PBJT (décision propriétaire du 2026-07-17, cf. ADR-005 NON-PKP).
-- Or le trigger recalculait un PB1 depuis le total et créditait 2110 quand même.
--
-- Constat sur la V3 dev au 2026-07-17, avant ce correctif :
--   * 10 commandes B2B payées, tax_amount cumulé = 0 ;
--   * mais 81 600 IDR crédités sur 2110 par leurs JE ;
--   * soit 9,38 % du PB1 déclaré (869 500 IDR) portant sur des ventes hors champ.
-- `calculate_pb1_payable_v1` sommant les crédits de 2110, ce PB1 fantôme
-- remontait jusqu'à la déclaration Bapenda — en SUR-déclaration.
--
-- À partir de cette migration, une vente B2B ne crédite plus 2110 (tax_amount=0
-- → v_vat = 0, v_net = total). L'AVENIR est corrigé.
--
-- ⚠️ NON TRAITÉ ICI, décision propriétaire du 2026-07-17 : les JE B2B DÉJÀ
--    passées gardent leurs lignes 2110 fantômes. La reprise de l'historique
--    (contre-passation, périodes potentiellement closes) et la position à tenir
--    vis-à-vis du Bapenda sont un sujet fiscal séparé, à traiter avec le
--    comptable. Ne pas supposer que la base est propre en amont de cette date.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Invariants préservés (checklist skill `accounting`)
--
--   * Équilibre : CR = v_net + v_vat = (total - tax) + tax = total = Σ DR. Vrai
--     dans les deux modes ET pour le B2B (v_vat = 0 → v_net = total).
--   * `journal_entry_lines_check` : la ligne PB1 n'est écrite que si v_vat > 0.
--     Régression trouvée par le pgTAP de cette tâche — avec tax_amount = 0, la
--     ligne (debit=0, credit=0) violait la contrainte et faisait ÉCHOUER le
--     paiement B2B. Le bug était masqué tant que v_vat était recalculé depuis
--     total (donc toujours > 0). Pas de taxe ⇒ pas de ligne de taxe.
--   * `check_fiscal_period_open(NEW.created_at::date)` — inchangé.
--   * Idempotence par `reference_type` + `reference_id` — inchangée.
--   * Mapping keys SALE_POS_REVENUE / SALE_PB1_TAX / SALE_PAYMENT_* — inchangés.
--   * `is_historical_import` toujours skippé (import_sales_v1 n'émet aucune JE).
--   * `current_pb1_rate()` reste lu, mais UNIQUEMENT pour le libellé de la ligne
--     PB1 — plus aucun calcul de montant n'en dépend. Aucun hardcode introduit.
--
-- Corps repris de `pg_get_functiondef` live. Trigger AFTER INSERT/UPDATE OF
-- status inchangé (pas de DROP/CREATE TRIGGER — seule la fonction change).

CREATE OR REPLACE FUNCTION public.create_sale_journal_entry()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_mapping   TEXT;
  v_acc_id    UUID;
BEGIN
  IF NEW.is_historical_import THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('paid', 'voided') THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  -- Lot 6a : v_rate ne sert PLUS qu'au libellé de la ligne PB1. Le montant vient
  -- de NEW.tax_amount (produit par _pb1_split_v1 côté money-path).
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

    -- Lot 6a : la commande fait foi. Ne JAMAIS recalculer ici — cf. encart 2
    -- (double arrondi en mode exclusive, PB1 fantôme sur les ventes B2B).
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

    -- `journal_entry_lines_check` interdit une ligne (debit = 0 AND credit = 0).
    -- Tant que le trigger recalculait la taxe depuis total, v_vat était toujours
    -- > 0 et le cas ne se posait pas. En lisant NEW.tax_amount, une vente hors
    -- champ (B2B, tax_amount = 0) produirait une ligne nulle → violation, et le
    -- paiement échouerait. Pas de taxe ⇒ pas de ligne de taxe.
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
      v_mapping := CASE v_pay.method
        WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
        WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
        WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'
        ELSE 'SALE_PAYMENT_CASH'
      END;
      v_acc_id := resolve_mapping_account(v_mapping);

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

  ELSIF NEW.status = 'voided' AND OLD.status = 'paid' THEN
    SELECT id INTO v_existing FROM journal_entries
      WHERE reference_type = 'sale_void' AND reference_id = NEW.id
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Lot 6a : idem branche 'paid' — la contre-passation doit annuler EXACTEMENT
    -- ce que la vente a écrit, donc partir de la même source (NEW.tax_amount).
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

    -- Symétrique de la branche 'paid' : pas de taxe à l'origine ⇒ rien à
    -- contre-passer (et une ligne nulle violerait journal_entry_lines_check).
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
      v_mapping := CASE v_pay.method
        WHEN 'cash'         THEN 'SALE_PAYMENT_CASH'
        WHEN 'qris'         THEN 'SALE_PAYMENT_QRIS'
        WHEN 'card'         THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'edc'          THEN 'SALE_PAYMENT_DEBIT'
        WHEN 'transfer'     THEN 'SALE_PAYMENT_TRANSFER'
        WHEN 'store_credit' THEN 'SALE_PAYMENT_CASH'
        ELSE 'SALE_PAYMENT_CASH'
      END;
      v_acc_id := resolve_mapping_account(v_mapping);

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

COMMENT ON FUNCTION public.create_sale_journal_entry IS
  'Trigger JE de vente (AFTER INSERT / UPDATE OF status ON orders). '
  'Lot 6a (2026-07-17) : le montant PB1 vient de orders.tax_amount, il n''est '
  'PLUS recalculé depuis total — supprime le double arrondi en mode exclusive et '
  'le PB1 fantôme sur les ventes B2B (create_b2b_order_v5 écrit tax_amount = 0 : '
  'vente en gros hors champ PBJT, ADR-005). current_pb1_rate() ne sert plus qu''au '
  'libellé. AVENIR corrigé uniquement — les JE B2B antérieures au 2026-07-17 '
  'gardent leurs lignes 2110 fantômes (reprise = sujet fiscal séparé).';
