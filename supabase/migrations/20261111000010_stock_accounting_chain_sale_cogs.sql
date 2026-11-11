-- S1-05 — Raccorder la chaîne comptable du stock et reconnaître le coût des ventes.
--
-- Avant : les achats débitaient 1141, la production consommait 1142 que rien
-- n'alimentait, produisait 1143 que rien ne soldait, et la vente ne touchait
-- aucun compte de stock ni de coût.
--
-- Après : chaque article suivi a UN compte de stock, et tous ses mouvements
-- passent par lui.
--   * article fabriqué (il porte une recette)  -> INVENTORY_FINISHED_GOODS (1143)
--   * article acheté (aucune recette)          -> INVENTORY_RAW_MATERIAL  (1142)
-- La réception débite 1142 ; la production sort du compte de chaque matière et
-- entre au compte de l'article fabriqué ; la vente débite le coût des ventes et
-- crédite le compte de l'article sorti ; l'annulation et le remboursement
-- (`sale_void`) font l'inverse ; perte, ajustement et inventaire touchent le
-- compte de l'article et non plus 1141.
--
-- Valorisation inchangée : `unit_cost` du mouvement, à défaut `cost_price` de
-- l'article. Un article valorisé à zéro n'émet toujours aucune écriture
-- (limite assumée, `S4-06`).
--
-- Hors périmètre : l'import historique garde son propre routage (1141).

-- 1. Clé de mapping du coût des ventes. 5110 est le compte que le plan vise ;
--    la clé reste réaffectable depuis l'écran des mappings.
INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active)
VALUES ('SALE_COGS', '5110', 'Cost of goods sold recognised when stock leaves on a sale', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- 2. Le compte de stock d'un article. « A une recette » couvre aussi les
--    recettes retirées : un article fabriqué hier ne change pas de compte le
--    jour où sa recette est archivée.
CREATE FUNCTION public._stock_inventory_mapping_key_v1(p_product_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM recipes r WHERE r.product_id = p_product_id)
      THEN 'INVENTORY_FINISHED_GOODS'
    ELSE 'INVENTORY_RAW_MATERIAL'
  END
$function$;

REVOKE ALL ON FUNCTION public._stock_inventory_mapping_key_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._stock_inventory_mapping_key_v1(uuid) TO service_role;

-- 3. Déclencheur comptable des mouvements de stock (corps live du 2026-11-11).
CREATE OR REPLACE FUNCTION public.tr_stock_movement_je()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_je_id       UUID;
  v_existing    UUID;
  v_entry_no    TEXT;
  v_value       DECIMAL(14,2);
  v_cost_price  DECIMAL(14,2);
  v_dr_account  UUID;
  v_cr_account  UUID;
  v_dr_desc     TEXT;
  v_cr_desc     TEXT;
  v_dr_key      TEXT;
  v_cr_key      TEXT;
  v_inv_key     TEXT;
BEGIN
  IF (NEW.metadata->>'reverse_of_production') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.movement_type NOT IN (
    'sale',          'sale_void',
    'waste',
    'adjustment',
    'adjustment_in', 'adjustment_out',
    'opname_in',     'opname_out',
    'production_in', 'production_out'
  ) THEN
    RETURN NEW;
  END IF;

  -- L'import historique porte ses propres écritures : pas de coût des ventes
  -- émis ici pour un mouvement de vente qu'il a planifié.
  IF NEW.movement_type IN ('sale', 'sale_void')
     AND COALESCE(NEW.metadata, '{}'::jsonb) ? 'financial_import_run_id' THEN
    RETURN NEW;
  END IF;

  v_cost_price := COALESCE(NEW.unit_cost, (SELECT cost_price FROM products WHERE id = NEW.product_id), 0);
  v_value      := round_idr(v_cost_price * ABS(NEW.quantity));

  IF v_value <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'stock_movement'
      AND reference_id   = NEW.id
      AND metadata->>'movement_type' = NEW.movement_type::TEXT
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  v_inv_key := _stock_inventory_mapping_key_v1(NEW.product_id);

  CASE NEW.movement_type
    WHEN 'sale' THEN
      v_dr_key := 'SALE_COGS'; v_cr_key := v_inv_key;
      v_dr_desc := 'Cost of goods sold'; v_cr_desc := 'Inventory sold';
    WHEN 'sale_void' THEN
      v_dr_key := v_inv_key; v_cr_key := 'SALE_COGS';
      v_dr_desc := 'Inventory returned (void / refund)'; v_cr_desc := 'Cost of goods sold reversed';
    WHEN 'waste' THEN
      v_dr_key := 'WASTE_EXPENSE'; v_cr_key := v_inv_key;
      v_dr_desc := 'Stock waste'; v_cr_desc := 'Inventory consumed (waste)';
    WHEN 'adjustment' THEN
      -- Legacy signed adjustment (adjust_stock_v1) : direction par le signe.
      IF NEW.quantity > 0 THEN
        v_dr_key := v_inv_key; v_cr_key := 'ADJUSTMENT_INCOME';
        v_dr_desc := 'Inventory positive adjustment'; v_cr_desc := 'Adjustment income';
      ELSE
        v_dr_key := 'ADJUSTMENT_EXPENSE'; v_cr_key := v_inv_key;
        v_dr_desc := 'Adjustment expense'; v_cr_desc := 'Inventory negative adjustment';
      END IF;
    WHEN 'adjustment_in' THEN
      v_dr_key := v_inv_key; v_cr_key := 'ADJUSTMENT_INCOME';
      v_dr_desc := 'Inventory positive adjustment'; v_cr_desc := 'Adjustment income';
    WHEN 'adjustment_out' THEN
      v_dr_key := 'ADJUSTMENT_EXPENSE'; v_cr_key := v_inv_key;
      v_dr_desc := 'Adjustment expense'; v_cr_desc := 'Inventory negative adjustment';
    WHEN 'opname_in' THEN
      v_dr_key := v_inv_key; v_cr_key := 'OPNAME_INCOME';
      v_dr_desc := 'Opname positive variance'; v_cr_desc := 'Opname income';
    WHEN 'opname_out' THEN
      v_dr_key := 'OPNAME_EXPENSE'; v_cr_key := v_inv_key;
      v_dr_desc := 'Opname expense'; v_cr_desc := 'Opname negative variance';
    WHEN 'production_in' THEN
      v_dr_key := v_inv_key; v_cr_key := 'PRODUCTION_COGS';
      v_dr_desc := 'Goods produced'; v_cr_desc := 'COGS reversal (paired with production_out)';
    WHEN 'production_out' THEN
      v_dr_key := 'PRODUCTION_COGS'; v_cr_key := v_inv_key;
      v_dr_desc := 'Material consumed'; v_cr_desc := 'Inventory consumed (production)';
    ELSE
      RETURN NEW;
  END CASE;

  v_dr_account := resolve_mapping_account(v_dr_key);
  v_cr_account := resolve_mapping_account(v_cr_key);

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by, metadata
  ) VALUES (
    v_entry_no,
    NEW.created_at::date,
    'Stock movement ' || NEW.movement_type::TEXT || ' for product ' || NEW.product_id::TEXT,
    'stock_movement',
    NEW.id,
    'posted',
    v_value,
    v_value,
    NEW.created_by,
    jsonb_build_object('movement_type', NEW.movement_type::TEXT)
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_dr_account, v_value, 0,       v_dr_desc),
    (v_je_id, v_cr_account, 0,       v_value, v_cr_desc);

  RETURN NEW;
END $function$;

-- 4. Écriture de réception (corps live du 2026-11-11) : la réception alimente
--    les matières premières. Seule la clé de stock change.
CREATE OR REPLACE FUNCTION public.create_purchase_journal_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inv_id          UUID;
  v_ap_id           UUID;
  v_je_id           UUID;
  v_existing_je     UUID;
  v_entry_no        TEXT;
  v_subtotal        DECIMAL(14,2);
  v_vat             DECIMAL(14,2);
  v_total           DECIMAL(14,2);
  v_inv_debit       DECIMAL(14,2);
  v_payment_terms   TEXT;
  v_grn_date        DATE;
  v_auto_pay_idem   UUID;
  v_auto_pay_exists BOOLEAN := FALSE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_orders WHERE id=NEW.po_id AND financial_import_document_id IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT id INTO v_existing_je FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = NEW.id
    LIMIT 1;
  IF v_existing_je IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_subtotal      := COALESCE(NEW.subtotal,      0);
  v_vat           := COALESCE(NEW.vat_amount,    0);
  v_total         := COALESCE(NEW.total,         0);
  v_payment_terms := COALESCE(NEW.payment_terms, 'credit');
  v_grn_date      := COALESCE(NEW.received_date, NEW.created_at::date);

  PERFORM check_fiscal_period_open(v_grn_date);

  v_inv_id := resolve_mapping_account('INVENTORY_RAW_MATERIAL');
  v_ap_id  := resolve_mapping_account('PURCHASE_PAYABLE');

  v_inv_debit := v_subtotal + v_vat;

  v_entry_no := next_journal_entry_number(v_grn_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description,
    reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_grn_date,
    'Purchase receipt ' || COALESCE(NEW.grn_number, NEW.id::text),
    'purchase', NEW.id,
    'posted', v_total, v_total,
    NEW.received_by
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_inv_id, v_inv_debit, 0,
      CASE WHEN v_vat > 0
        THEN 'Inventory received (incl. non-recoverable PPN ' || v_vat::TEXT || ')'
        ELSE 'Inventory received'
      END);

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_ap_id, 0, v_total, 'AP recorded at receipt');

  IF v_payment_terms = 'cash' THEN
    v_auto_pay_idem := md5('auto_cash_pay:' || NEW.id::text)::uuid;

    SELECT EXISTS (
      SELECT 1 FROM purchase_payments WHERE idempotency_key = v_auto_pay_idem
    ) INTO v_auto_pay_exists;

    IF NOT v_auto_pay_exists THEN
      PERFORM _record_po_payment_internal(
        p_po_id           := NEW.po_id,
        p_amount          := v_total,
        p_method          := 'cash',
        p_reference       := 'Auto-payment at receipt: ' || COALESCE(NEW.grn_number, NEW.id::text),
        p_idempotency_key := v_auto_pay_idem,
        p_actor           := NEW.received_by
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Écriture de régularisation du passé (décision de Mamat du 2026-11-11).
--    Une seule écriture, datée du jour d'exécution, qui porte :
--      A. le coût des ventes des mouvements `sale` / `sale_void` restés sans
--         écriture, valorisés au `unit_cost` du mouvement, à défaut au
--         `cost_price` ACTUEL de l'article (le coût d'époque n'a pas été gardé) ;
--      B. le reclassement des réceptions passées, de 1141 vers 1142 ;
--      C. le reclassement des écritures de mouvement passées (et de leurs
--         contre-passations de production) posées sur un autre compte de
--         stock que celui de l'article.
--    `p_dry_run` (défaut) calcule et rend le détail sans rien écrire.
--    Geste unique : un second passage réel est refusé.
CREATE FUNCTION public.post_stock_chain_catchup_v1(
  p_dry_run boolean DEFAULT true,
  p_actor   uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date        DATE := now()::date;
  v_general     UUID := resolve_mapping_account('INVENTORY_GENERAL');
  v_raw         UUID := resolve_mapping_account('INVENTORY_RAW_MATERIAL');
  v_finished    UUID := resolve_mapping_account('INVENTORY_FINISHED_GOODS');
  v_cogs        UUID := resolve_mapping_account('SALE_COGS');
  v_sale_cnt    INT;
  v_zero_cnt    INT;
  v_cogs_total  NUMERIC(14,2);
  v_purch_total NUMERIC(14,2);
  v_mv_total    NUMERIC(14,2);
  v_debit       NUMERIC(14,2);
  v_credit      NUMERIC(14,2);
  v_lines       JSONB;
  v_je_id       UUID;
  v_entry_no    TEXT;
  v_summary     JSONB;
BEGIN
  IF EXISTS (SELECT 1 FROM journal_entries
              WHERE reference_type = 'manual'
                AND metadata->>'kind' = 'stock_chain_catchup'
                AND status IN ('posted','locked')) THEN
    IF p_dry_run THEN
      RETURN jsonb_build_object('already_posted', true);
    END IF;
    RAISE EXCEPTION 'stock_chain_catchup_already_posted' USING ERRCODE = 'P0003';
  END IF;

  CREATE TEMP TABLE _catchup_parts (part text, account_id uuid, amount numeric(14,2)) ON COMMIT DROP;

  -- A. Coût des ventes des mouvements sans écriture.
  WITH mv AS (
    SELECT sm.id, sm.movement_type, sm.product_id,
           round_idr(COALESCE(sm.unit_cost, p.cost_price, 0) * ABS(sm.quantity)) AS value
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.movement_type IN ('sale', 'sale_void')
       AND NOT (COALESCE(sm.metadata, '{}'::jsonb) ? 'financial_import_run_id')
       AND NOT EXISTS (SELECT 1 FROM journal_entries je
                        WHERE je.reference_type = 'stock_movement' AND je.reference_id = sm.id)
  ), signed AS (
    SELECT product_id,
           CASE WHEN movement_type = 'sale' THEN value ELSE -value END AS cogs
      FROM mv WHERE value > 0
  )
  INSERT INTO _catchup_parts
  SELECT 'A', v_cogs, SUM(cogs) FROM signed HAVING SUM(cogs) IS NOT NULL
  UNION ALL
  SELECT 'A', resolve_mapping_account(_stock_inventory_mapping_key_v1(product_id)), -SUM(cogs)
    FROM signed GROUP BY 2;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE COALESCE(sm.unit_cost, p.cost_price, 0) = 0)
    INTO v_sale_cnt, v_zero_cnt
    FROM stock_movements sm JOIN products p ON p.id = sm.product_id
   WHERE sm.movement_type IN ('sale', 'sale_void')
     AND NOT (COALESCE(sm.metadata, '{}'::jsonb) ? 'financial_import_run_id')
     AND NOT EXISTS (SELECT 1 FROM journal_entries je
                      WHERE je.reference_type = 'stock_movement' AND je.reference_id = sm.id);

  -- B. Réceptions passées : 1141 -> 1142.
  IF v_general <> v_raw THEN
    INSERT INTO _catchup_parts
    SELECT 'B', x.account_id, x.amount
      FROM (
        SELECT SUM(jel.debit - jel.credit) AS net
          FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE je.reference_type = 'purchase'
           AND je.status IN ('posted','locked')
           AND jel.account_id = v_general
      ) s
      CROSS JOIN LATERAL (VALUES (v_general, -s.net), (v_raw, s.net)) AS x(account_id, amount)
     WHERE COALESCE(s.net, 0) <> 0;
  END IF;

  -- C. Écritures de mouvement posées sur un autre compte de stock que celui
  --    de l'article, contre-passations de production comprises.
  WITH src AS (
    SELECT jel.account_id, (jel.debit - jel.credit) AS net, sm.product_id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      JOIN stock_movements sm ON sm.id = je.reference_id
     WHERE je.reference_type = 'stock_movement'
       AND je.status IN ('posted','locked')
       AND jel.account_id IN (v_general, v_raw, v_finished)
    UNION ALL
    SELECT jel.account_id, (jel.debit - jel.credit), sm.product_id
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      JOIN journal_entries orig ON orig.id = NULLIF(je.metadata->>'original_je_id', '')::uuid
      JOIN stock_movements sm ON sm.id = orig.reference_id
     WHERE je.reference_type = 'production'
       AND je.status IN ('posted','locked')
       AND orig.reference_type = 'stock_movement'
       AND jel.account_id IN (v_general, v_raw, v_finished)
  ), moved AS (
    SELECT account_id AS from_account,
           resolve_mapping_account(_stock_inventory_mapping_key_v1(product_id)) AS to_account,
           net
      FROM src
  )
  INSERT INTO _catchup_parts
  SELECT 'C', x.account_id, SUM(x.amount)
    FROM moved m
    CROSS JOIN LATERAL (VALUES (m.from_account, -m.net), (m.to_account, m.net)) AS x(account_id, amount)
   WHERE m.from_account <> m.to_account
   GROUP BY x.account_id
  HAVING SUM(x.amount) <> 0;

  SELECT COALESCE(SUM(amount) FILTER (WHERE part = 'A' AND account_id = v_cogs), 0),
         COALESCE(SUM(amount) FILTER (WHERE part = 'B' AND account_id = v_raw), 0),
         COALESCE(SUM(amount) FILTER (WHERE part = 'C' AND amount > 0), 0)
    INTO v_cogs_total, v_purch_total, v_mv_total
    FROM _catchup_parts;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'account', a.code, 'name', a.name,
           'debit',  CASE WHEN n.net > 0 THEN n.net ELSE 0 END,
           'credit', CASE WHEN n.net < 0 THEN -n.net ELSE 0 END) ORDER BY a.code), '[]'::jsonb),
         COALESCE(SUM(n.net) FILTER (WHERE n.net > 0), 0),
         COALESCE(-SUM(n.net) FILTER (WHERE n.net < 0), 0)
    INTO v_lines, v_debit, v_credit
    FROM (SELECT account_id, SUM(amount) AS net FROM _catchup_parts GROUP BY 1 HAVING SUM(amount) <> 0) n
    JOIN accounts a ON a.id = n.account_id;

  v_summary := jsonb_build_object(
    'dry_run',                 p_dry_run,
    'entry_date',              v_date,
    'sale_movements',          v_sale_cnt,
    'zero_cost_movements',     v_zero_cnt,
    'cogs_recognised',         v_cogs_total,
    'purchases_reclassified',  v_purch_total,
    'movements_reclassified',  v_mv_total,
    'total_debit',             v_debit,
    'total_credit',            v_credit,
    'lines',                   v_lines,
    'valuation',               'movement unit_cost, else current product cost_price'
  );

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'stock_chain_catchup_unbalanced: % vs %', v_debit, v_credit USING ERRCODE = 'P0001';
  END IF;

  IF p_dry_run OR v_debit = 0 THEN
    DROP TABLE _catchup_parts;
    RETURN v_summary || jsonb_build_object('posted', false);
  END IF;

  PERFORM check_fiscal_period_open(v_date);
  v_entry_no := next_journal_entry_number(v_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by, metadata
  ) VALUES (
    v_entry_no, v_date,
    'Stock chain catch-up — cost of past sales and inventory account reclassification',
    'manual', NULL, 'posted', v_debit, v_credit, p_actor,
    jsonb_build_object('kind', 'stock_chain_catchup') || (v_summary - 'lines' - 'dry_run')
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  SELECT v_je_id, n.account_id,
         CASE WHEN n.net > 0 THEN n.net ELSE 0 END,
         CASE WHEN n.net < 0 THEN -n.net ELSE 0 END,
         'Stock chain catch-up'
    FROM (SELECT account_id, SUM(amount) AS net FROM _catchup_parts GROUP BY 1 HAVING SUM(amount) <> 0) n;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('accounting.stock_chain.catchup_posted', 'journal_entries', v_je_id,
          v_summary - 'dry_run', p_actor);

  DROP TABLE _catchup_parts;
  RETURN v_summary || jsonb_build_object('posted', true, 'je_id', v_je_id, 'entry_number', v_entry_no);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_stock_chain_catchup_v1(boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_chain_catchup_v1(boolean, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
