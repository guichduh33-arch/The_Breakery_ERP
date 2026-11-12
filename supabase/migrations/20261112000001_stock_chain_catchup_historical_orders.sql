-- S1-05, suite — l'écriture de régularisation compte aussi les ventes passées
-- qui n'ont laissé aucun mouvement de stock.
--
-- Arbitrage de Mamat du 2026-11-11 : le coût des ventes se calcule sur la
-- fiche de l'article vendu, qu'il soit suivi en stock ou non. Relevé en
-- production le même jour : les mouvements de vente n'existent que depuis le
-- 2026-10-31 ; les ventes payées de septembre et d'octobre, importées, n'en
-- portent aucun et valaient zéro dans le premier calcul.
--
-- Partie D, ajoutée ici : pour chaque commande payée de l'import historique
-- (`is_historical_import` ou document d'import financier) sans mouvement de vente,
-- quantité x coût actuel de la fiche (un combo = somme de ses composants
-- gardés sur la ligne). Débit du coût des ventes, crédit du compte général de
-- stock, là où l'import historique a rangé les achats de cette période.
--
-- Limites écrites : coût ACTUEL de la fiche, pas celui du jour de la vente ;
-- un combo importé sans ses composants ne peut pas être valorisé (compté à
-- part dans le résumé) ; un article à coût zéro vaut zéro ; les commandes non
-- payées ne sont pas reprises ; les ingrédients de modificateurs ne sont pas
-- valorisés ; un remboursement partiel n'est pas déduit (aucun n'existe sur ces
-- commandes au relevé de production du 2026-11-12). Une commande courante sans
-- mouvement de vente n'est PAS reprise : son coût viendra de son mouvement.
--
-- Le reste du corps est celui de la version précédente, égal au live (md5
-- vérifié en dev et en production le 2026-11-11). Elle n'a été exécutée
-- nulle part : elle est remplacée, pas complétée.

CREATE FUNCTION public.post_stock_chain_catchup_v2(
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
  v_hist_total  NUMERIC(14,2);
  v_hist_orders INT;
  v_hist_zero   INT;
  v_hist_combo  INT;
  v_debit       NUMERIC(14,2);
  v_credit      NUMERIC(14,2);
  v_lines       JSONB;
  v_je_id       UUID;
  v_entry_no    TEXT;
  v_summary     JSONB;
BEGIN
  -- Deux passages réels simultanés ne doivent pas franchir ensemble la garde.
  PERFORM pg_advisory_xact_lock(hashtextextended('stock-chain-catchup', 0));

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
           -- L'import historique garde son routage : ses réceptions restent sur 1141.
           AND NOT (COALESCE(je.metadata, '{}'::jsonb) ? 'financial_import_run_id')
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

  -- D. Ventes payées qui n'ont laissé AUCUN mouvement de stock (historique
  --    importé avant la mise en service, articles non suivis) : coût de la
  --    fiche de l'article vendu, suivi en stock ou non. Un combo vaut la somme
  --    de ses composants quand la ligne les a gardés. Le stock correspondant
  --    est sorti du compte général, où l'import historique a rangé les achats.
  CREATE TEMP TABLE _catchup_hist ON COMMIT DROP AS
  SELECT oi.id AS item_id, o.id AS order_id, p.product_type,
         CASE WHEN p.product_type = 'combo' THEN
                (SELECT COALESCE(SUM(round_idr(oi.quantity * (c->>'quantity')::numeric * COALESCE(cp.cost_price, 0))), 0)
                   FROM jsonb_array_elements(COALESCE(oi.combo_components, '[]'::jsonb)) c
                   LEFT JOIN products cp ON cp.id::text = c->>'product_id')
              ELSE round_idr(oi.quantity * COALESCE(p.cost_price, 0))
         END AS value
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id AND COALESCE(oi.is_cancelled, false) = false
    JOIN products p ON p.id = oi.product_id
   WHERE o.status = 'paid'
     -- Historique importé seulement : une commande courante sans mouvement
     -- (B2B payée avant retrait) sera valorisée par son mouvement, plus tard.
     AND (o.is_historical_import OR o.financial_import_document_id IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM stock_movements sm
                      WHERE sm.reference_id = o.id AND sm.movement_type = 'sale');

  SELECT COALESCE(SUM(value), 0), COUNT(DISTINCT order_id),
         COUNT(*) FILTER (WHERE value = 0 AND product_type <> 'combo'),
         COUNT(*) FILTER (WHERE value = 0 AND product_type = 'combo')
    INTO v_hist_total, v_hist_orders, v_hist_zero, v_hist_combo
    FROM _catchup_hist;
  DROP TABLE _catchup_hist;

  IF v_hist_total > 0 THEN
    INSERT INTO _catchup_parts VALUES ('D', v_cogs, v_hist_total), ('D', v_general, -v_hist_total);
  END IF;

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
    'historical_orders',            v_hist_orders,
    'historical_cogs',              v_hist_total,
    'historical_zero_cost_lines',   v_hist_zero,
    'historical_uncosted_combos',   v_hist_combo,
    'total_debit',             v_debit,
    'total_credit',            v_credit,
    'lines',                   v_lines,
    'valuation',               'movement unit_cost, else current product cost_price; orders without movement at current product cost_price'
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
    'Stock chain catch-up — cost of past sales (stock movements and historical orders) and inventory account reclassification',
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

DROP FUNCTION public.post_stock_chain_catchup_v1(boolean, uuid);

REVOKE ALL ON FUNCTION public.post_stock_chain_catchup_v2(boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_chain_catchup_v2(boolean, uuid) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
