-- 20260818000009_get_supplier_payments_v1.sql
--
-- Rapport « Règlements fournisseurs » (famille Purchases) — le symétrique de
-- l'AR aging, côté dettes. Répond à : « qu'ai-je décaissé vers les
-- fournisseurs, et combien reste-t-il à payer — à qui ? » (maquette +
-- arbitrages validés par Mamat le 2026-08-17).
--
-- DEUX VOLETS, DEUX NATURES DE CHIFFRE :
--   * DÉCAISSÉ (période + comparaison) — le ledger append-only
--     `purchase_payments`, jour métier sur paid_at ; servi au jour (by_day),
--     la page plie en semaines.
--   * ENCOURS (snapshot, pas de période) — PO `received` UNIQUEMENT
--     (arbitrage : un PO commandé non reçu est un engagement, pas une dette),
--     HORS imports historiques (arbitrage : exclus de l'encours), non
--     supprimés, non annulés ; solde = total_amount − Σ règlements, > 0.
--
-- DÉLAI MOYEN DE RÈGLEMENT : moyenne pondérée par montant des
-- (paid_at − received_date) sur les règlements de la fenêtre — NULL si aucun
-- règlement ou si le PO n'a pas de received_date.

CREATE OR REPLACE FUNCTION public.get_supplier_payments_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         text;
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_today      date;
  v_result     jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  -- Clamp 366 jours (pattern S30/S40) : on rogne le DÉBUT.
  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  WITH pay AS (
    SELECT
      pp.id, pp.amount, pp.method, pp.reference,
      ((pp.paid_at AT TIME ZONE v_tz))::date AS bd,
      po.id AS po_id, po.po_number, po.received_date,
      s.id  AS supplier_id, s.name AS supplier_name
    FROM purchase_payments pp
    JOIN purchase_orders po ON po.id = pp.purchase_order_id
    JOIN suppliers       s  ON s.id  = po.supplier_id
    WHERE ((pp.paid_at AT TIME ZONE v_tz))::date BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM pay WHERE bd BETWEEN v_start AND v_end),
  prev AS (SELECT * FROM pay WHERE bd <  v_start),
  -- L'encours : PO reçus, hors imports historiques, solde ouvert.
  open_po AS (
    SELECT
      po.id, po.po_number, po.total_amount, po.received_date,
      s.id AS supplier_id, s.name AS supplier_name,
      COALESCE((SELECT SUM(pp.amount) FROM purchase_payments pp
                 WHERE pp.purchase_order_id = po.id), 0) AS settled,
      GREATEST(v_today - po.received_date, 0)            AS age_days
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status = 'received'
      AND po.deleted_at IS NULL
      AND po.is_historical_import = false
  ),
  open_bal AS (
    SELECT *, total_amount - settled AS outstanding
    FROM open_po
    WHERE total_amount - settled > 0
  ),
  settle AS (
    SELECT CASE WHEN SUM(c.amount) > 0 AND COUNT(*) FILTER (WHERE c.received_date IS NOT NULL) > 0 THEN
      ROUND(SUM(c.amount * (c.bd - c.received_date))
              FILTER (WHERE c.received_date IS NOT NULL)::numeric
            / NULLIF(SUM(c.amount) FILTER (WHERE c.received_date IS NOT NULL), 0), 1)
    END AS days
    FROM cur c
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'as_of',        v_today,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'paid_total',          COALESCE((SELECT SUM(amount) FROM cur), 0),
      'paid_total_prev',     COALESCE((SELECT SUM(amount) FROM prev), 0),
      'payments_count',      (SELECT COUNT(*) FROM cur),
      'outstanding_total',   COALESCE((SELECT SUM(outstanding) FROM open_bal), 0),
      'open_po_count',       (SELECT COUNT(*) FROM open_bal),
      'supplier_count',      (SELECT COUNT(DISTINCT supplier_id) FROM open_bal),
      'oldest_open_days',    COALESCE((SELECT MAX(age_days) FROM open_bal), 0),
      'avg_settlement_days', (SELECT days FROM settle)
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d.bd, 'amount', d.amount, 'count', d.n
      ) ORDER BY d.bd ASC)
      FROM (
        SELECT bd, SUM(amount) AS amount, COUNT(*) AS n
        FROM cur GROUP BY bd
      ) d
    ), '[]'::jsonb),
    'by_supplier_outstanding', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'supplier_id',  bs.supplier_id,
        'supplier_name', bs.supplier_name,
        'outstanding',  bs.outstanding,
        'po_count',     bs.po_count,
        'oldest_days',  bs.oldest_days
      ) ORDER BY bs.outstanding DESC)
      FROM (
        SELECT supplier_id, supplier_name,
               SUM(outstanding) AS outstanding,
               COUNT(*)         AS po_count,
               MAX(age_days)    AS oldest_days
        FROM open_bal
        GROUP BY supplier_id, supplier_name
      ) bs
    ), '[]'::jsonb),
    'open_pos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'po_id',         ob.id,
        'po_number',     ob.po_number,
        'supplier_id',   ob.supplier_id,
        'supplier_name', ob.supplier_name,
        'received_on',   ob.received_date,
        'total',         ob.total_amount,
        'settled',       ob.settled,
        'outstanding',   ob.outstanding,
        'age_days',      ob.age_days
      ) ORDER BY ob.age_days DESC, ob.outstanding DESC)
      FROM open_bal ob
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'payment_id',    c.id,
        'po_id',         c.po_id,
        'po_number',     c.po_number,
        'supplier_name', c.supplier_name,
        'amount',        c.amount,
        'method',        c.method,
        'reference',     c.reference,
        'paid_on',       c.bd
      ) ORDER BY c.bd DESC, c.amount DESC)
      FROM cur c
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_supplier_payments_v1(date, date) IS
  'Règlements fournisseurs — décaissé sur la période (ledger purchase_payments, '
  'jour métier, fenêtre précédente pour le delta) + encours snapshot (PO '
  'received uniquement, hors imports historiques — arbitrages 2026-08-17 —, '
  'solde = total − Σ règlements). Délai moyen de règlement pondéré par montant '
  '(réception → paiement). Gate reports.financial.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_supplier_payments_v1(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_supplier_payments_v1(date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_supplier_payments_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
