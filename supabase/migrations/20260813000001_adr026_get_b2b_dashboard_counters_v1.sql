-- 20260813000001_adr026_get_b2b_dashboard_counters_v1.sql
-- ADR-026 — le dashboard B2B : les agrégats quittent le client.
--
-- Le hook lisait view_b2b_invoices EN ENTIER (sans pagination) et agrégeait en
-- mémoire revenu mensuel, variation, top clients, clients actifs ; l'encours et
-- l'aging relisaient view_ar_aging. Classe de défaut ADR-024 : un agrégat
-- calculé sur les lignes chargées est un échantillon présenté comme un total.
-- Cette famille sert les agrégats côté serveur, là où vivent toutes les lignes.
--
-- Fuseau (ADR-026 déc. 2 / ADR-019) : les bornes de mois se calculent dans le
-- fuseau métier — paramètre de session PostgreSQL posé pour toute la base
-- (Asia/Makassar) — plus jamais dans celui du navigateur.
--
-- Gate : b2b.read (la même exigence que les lectures remplacées), erreurs en
-- 42501 comme la famille get_orders_counters (modèle ADR-025).

CREATE OR REPLACE FUNCTION public.get_b2b_dashboard_counters_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_month_start TIMESTAMPTZ := date_trunc('month', now());
  v_prev_start  TIMESTAMPTZ := date_trunc('month', now()) - interval '1 month';
  v_result      JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'b2b.read') THEN
    RAISE EXCEPTION 'Permission denied: b2b.read' USING ERRCODE = '42501';
  END IF;

  WITH inv AS (
    -- view_b2b_invoices exclut déjà voided, les clients supprimés et tout ce
    -- qui n'est pas order_type='b2b' : la surface canonique des factures B2B.
    SELECT v.customer_id, v.invoice_total, v.invoice_date, v.paid_at
    FROM view_b2b_invoices v
  ),
  per_client AS (
    SELECT i.customer_id,
           COUNT(*)::int                    AS orders,
           COALESCE(SUM(i.invoice_total), 0) AS spent,
           MAX(i.invoice_date)              AS last_order
    FROM inv i
    WHERE i.customer_id IS NOT NULL
    GROUP BY i.customer_id
  ),
  top_clients AS (
    SELECT c.id,
           c.name,
           c.b2b_company_name,
           COALESCE(c.b2b_current_balance, 0) AS b2b_current_balance,
           c.b2b_credit_limit,
           pc.spent      AS total_spent,
           pc.orders     AS total_visits,
           pc.last_order AS last_visit_at
    FROM per_client pc
    JOIN customers c ON c.id = pc.customer_id
    WHERE c.deleted_at IS NULL
    ORDER BY pc.spent DESC
    LIMIT 5
  ),
  aging AS (
    SELECT a.bucket,
           COALESCE(SUM(a.invoice_count), 0)::int  AS cnt,
           COALESCE(SUM(a.total_outstanding), 0)   AS amt
    FROM view_ar_aging a
    GROUP BY a.bucket
  )
  SELECT jsonb_build_object(
    'active_clients',       (SELECT COUNT(*)::int FROM per_client),
    'monthly_revenue',      COALESCE((SELECT SUM(i.invoice_total) FROM inv i
                                      WHERE i.invoice_date >= v_month_start), 0),
    'prev_monthly_revenue', COALESCE((SELECT SUM(i.invoice_total) FROM inv i
                                      WHERE i.invoice_date >= v_prev_start
                                        AND i.invoice_date <  v_month_start), 0),
    'outstanding_ar',       COALESCE((SELECT SUM(a.amt) FROM aging a), 0),
    'pending_orders',       (SELECT COUNT(*)::int FROM inv i WHERE i.paid_at IS NULL),
    'total_orders',         (SELECT COUNT(*)::int FROM inv i),
    'top_clients',          COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.total_spent DESC)
                                      FROM top_clients t), '[]'::jsonb),
    'aging',                COALESCE((SELECT jsonb_object_agg(a.bucket,
                                        jsonb_build_object('count', a.cnt, 'total', a.amt))
                                      FROM aging a), '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_b2b_dashboard_counters_v1() IS
  'ADR-026 — agrégats du dashboard B2B servis côté serveur (clients actifs, revenu mensuel + mois précédent en fuseau métier, encours, top clients bornés, aging). Gate b2b.read, erreurs 42501.';

-- Défense en profondeur anon : REVOKE seul sur anon est insuffisant, anon
-- hérite EXECUTE via PUBLIC (CLAUDE.md, patterns critiques).
REVOKE EXECUTE ON FUNCTION public.get_b2b_dashboard_counters_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_b2b_dashboard_counters_v1() FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_b2b_dashboard_counters_v1() TO authenticated;
