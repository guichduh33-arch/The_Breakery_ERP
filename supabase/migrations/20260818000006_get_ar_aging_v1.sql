-- 20260818000006_get_ar_aging_v1.sql
--
-- Rapport « Impayés clients — AR aging B2B » (famille Finance) — l'argent
-- dehors. Répond à : « qui me doit quoi, depuis combien de temps — et qui
-- relancer aujourd'hui ? » (maquette validée par Mamat le 2026-08-17).
--
-- SNAPSHOT COURANT, PAS DE PÉRIODE (arbitrage assumé) : une facture est une
-- créance tant qu'elle est `b2b_pending` ; son encours = total − Σ allocations
-- (`b2b_payment_allocations` — record_b2b_payment_v2 pose `paid` quand la
-- facture est couverte, une partielle reste pending). Un as-of historique
-- serait inexact : une facture B2B payée comptant (status `paid` d'emblée,
-- sans allocation) serait indistinguable d'une créance recouvrée — on ne
-- reconstruit pas ce que le ledger ne sait pas dire.
--
-- ÉCHÉANCE = jour métier d'émission + terms du client
-- (COALESCE(b2b_payment_terms_days, 30) — défaut 30 j validé par Mamat).
-- BUCKETS par jours de RETARD (après échéance, pas par âge de facture — c'est
-- ce qui distingue ce rapport de view_ar_aging du module B2B) :
-- current / 1-30 / 31-60 / 61-90 / 90+.
--
-- DSO 90 j : moyenne pondérée par montant des délais émission → règlement sur
-- les allocations des 90 derniers jours. NULL si aucun règlement alloué.
--
-- RÉCONCILIATION : by_customer expose balance_cached
-- (customers.b2b_current_balance, la source de vérité du solde) à côté de
-- l'encours recalculé — la page peut signaler un drift au lieu de le masquer.
--
-- PÉRIMÈTRE : les imports historiques restent INCLUS (une créance importée est
-- de l'argent réel) ; pas d'exclusion des produits de test — ce rapport doit
-- se réconcilier avec b2b_current_balance, qui ne les exclut pas non plus.

CREATE OR REPLACE FUNCTION public.get_ar_aging_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_today  date;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  WITH open_inv AS (
    SELECT
      o.id, o.order_number, o.invoice_number, o.customer_id,
      ((o.created_at AT TIME ZONE v_tz))::date AS issued_on,
      o.total,
      COALESCE((SELECT SUM(a.amount_applied)
                  FROM b2b_payment_allocations a
                 WHERE a.invoice_id = o.id), 0)  AS settled,
      COALESCE(c.b2b_payment_terms_days, 30)     AS terms_days,
      c.name                                     AS customer_name,
      NULLIF(c.b2b_company_name, '')             AS company,
      c.b2b_credit_limit,
      c.b2b_current_balance
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.order_type = 'b2b'
      AND o.status     = 'b2b_pending'
  ),
  inv AS (
    SELECT oi.*,
      oi.total - oi.settled                                AS outstanding,
      oi.issued_on + oi.terms_days                         AS due_date,
      GREATEST(v_today - (oi.issued_on + oi.terms_days), 0) AS days_late,
      CASE
        WHEN v_today <= oi.issued_on + oi.terms_days       THEN 'current'
        WHEN v_today - (oi.issued_on + oi.terms_days) <= 30 THEN 'late_1_30'
        WHEN v_today - (oi.issued_on + oi.terms_days) <= 60 THEN 'late_31_60'
        WHEN v_today - (oi.issued_on + oi.terms_days) <= 90 THEN 'late_61_90'
        ELSE 'late_90_plus'
      END AS bucket
    FROM open_inv oi
    WHERE oi.total - oi.settled > 0
  ),
  dso AS (
    SELECT CASE WHEN SUM(a.amount_applied) > 0 THEN
      ROUND(SUM(a.amount_applied *
                (((p.paid_at AT TIME ZONE v_tz))::date
                 - ((o.created_at AT TIME ZONE v_tz))::date))::numeric
            / SUM(a.amount_applied), 1)
    END AS days
    FROM b2b_payment_allocations a
    JOIN b2b_payments p ON p.id = a.payment_id
    JOIN orders       o ON o.id = a.invoice_id
    WHERE ((p.paid_at AT TIME ZONE v_tz))::date >= v_today - 90
  )
  SELECT jsonb_build_object(
    'as_of',              v_today,
    'timezone',           v_tz,
    'generated_at',       now(),
    'terms_default_days', 30,
    'summary', jsonb_build_object(
      'total_outstanding',     COALESCE((SELECT SUM(outstanding) FROM inv), 0),
      'overdue_total',         COALESCE((SELECT SUM(outstanding) FROM inv WHERE bucket <> 'current'), 0),
      'invoice_count',         (SELECT COUNT(*) FROM inv),
      'overdue_invoice_count', (SELECT COUNT(*) FROM inv WHERE bucket <> 'current'),
      'customer_count',        (SELECT COUNT(DISTINCT customer_id) FROM inv),
      'oldest_days_late',      COALESCE((SELECT MAX(days_late) FROM inv), 0),
      'oldest_customer',       (SELECT customer_name FROM inv
                                 ORDER BY days_late DESC, outstanding DESC LIMIT 1),
      'dso_90d',               (SELECT days FROM dso)
    ),
    -- Les 5 buckets sortent TOUJOURS, même vides — la page ne devine pas.
    'by_bucket', (
      SELECT jsonb_agg(jsonb_build_object(
        'bucket',        b.code,
        'amount',        COALESCE(x.amount, 0),
        'invoice_count', COALESCE(x.n, 0)
      ) ORDER BY b.ord)
      FROM (VALUES
        ('current', 1), ('late_1_30', 2), ('late_31_60', 3),
        ('late_61_90', 4), ('late_90_plus', 5)
      ) AS b(code, ord)
      LEFT JOIN (
        SELECT bucket, SUM(outstanding) AS amount, COUNT(*) AS n
        FROM inv GROUP BY bucket
      ) x ON x.bucket = b.code
    ),
    'by_customer', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'customer_id',       bc.customer_id,
        'customer_name',     bc.customer_name,
        'company',           bc.company,
        'terms_days',        bc.terms_days,
        'credit_limit',      bc.b2b_credit_limit,
        'balance_cached',    bc.b2b_current_balance,
        'current',           bc.amt_current,
        'late_1_30',         bc.amt_1_30,
        'late_31_60',        bc.amt_31_60,
        'late_61_90',        bc.amt_61_90,
        'late_90_plus',      bc.amt_90p,
        'total_outstanding', bc.total_outstanding,
        'max_days_late',     bc.max_days_late
      ) ORDER BY bc.total_outstanding DESC)
      FROM (
        SELECT customer_id, customer_name, company, terms_days,
               b2b_credit_limit, b2b_current_balance,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'current'),      0) AS amt_current,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_1_30'),    0) AS amt_1_30,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_31_60'),   0) AS amt_31_60,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_61_90'),   0) AS amt_61_90,
               COALESCE(SUM(outstanding) FILTER (WHERE bucket = 'late_90_plus'), 0) AS amt_90p,
               SUM(outstanding) AS total_outstanding,
               MAX(days_late)   AS max_days_late
        FROM inv
        GROUP BY customer_id, customer_name, company, terms_days,
                 b2b_credit_limit, b2b_current_balance
      ) bc
    ), '[]'::jsonb),
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'invoice_id',     i.id,
        'order_number',   i.order_number,
        'invoice_number', i.invoice_number,
        'customer_id',    i.customer_id,
        'customer_name',  i.customer_name,
        'issued_on',      i.issued_on,
        'due_date',       i.due_date,
        'days_late',      i.days_late,
        'bucket',         i.bucket,
        'total',          i.total,
        'settled',        i.settled,
        'outstanding',    i.outstanding
      ) ORDER BY i.days_late DESC, i.outstanding DESC)
      FROM inv i
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_ar_aging_v1() IS
  'AR aging B2B — snapshot courant des créances : factures b2b_pending, encours '
  'au grain facture (total − Σ b2b_payment_allocations), échéance = émission + '
  'terms client (défaut 30 j), buckets par jours de RETARD (current/1-30/31-60/'
  '61-90/90+), DSO 90 j pondéré par allocations, balance_cached exposée par '
  'client pour la réconciliation. Gate reports.financial.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_ar_aging_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ar_aging_v1() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ar_aging_v1() TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
