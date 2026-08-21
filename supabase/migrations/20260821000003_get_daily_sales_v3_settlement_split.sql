-- 20260821000003_get_daily_sales_v3_settlement_split.sql
--
-- POURQUOI. La page « Daily sales » juxtapose trois « Total » qui ne parlent pas
-- de la même population, et n'en nomme aucun :
--   · NET REVENUE / DAY BY DAY / BY CASHIER  → get_daily_sales_v2  : 3 257 500 sur 40 commandes
--   · PAYMENTS                                → get_payments_by_method_v3 : 2 257 500 sur 26
--   · REVENUE BY CATEGORY / TOP PRODUCTS      → get_pos_margin_v1  : 2 817 500 sur 42
-- Mesuré sur la base dev le 2026-08-21, période du 25 juil. au 21 août. L'écart
-- de 1 000 000 entre les deux premiers est EXACTEMENT quatorze commandes B2B
-- réglées au grand livre AR, sans ligne dans `order_payments`.
--
-- Six chiffres étiquetés « Total » dans la même typographie, trois périmètres
-- silencieusement différents : c'est la pièce principale du comptable, et une
-- seule découverte de cet écart détruit la confiance dans les 46 rapports
-- (Principe produit 3 : un chiffre sans son origine est inutile).
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE REFUSE DE FAIRE. Le correctif
-- évident — laisser la PAGE soustraire 3,26 − 2,26 et écrire « c'est du B2B » —
-- recrée le défaut un cran plus loin : l'interface DEVINERAIT la cause, et
-- continuerait d'afficher « B2B » le jour où l'écart aura une autre origine.
-- La ventilation vient donc du serveur, avec le chiffre qu'elle explique
-- (Principe produit 1 : la vérité est au serveur, jamais le client).
--
-- LE CRITÈRE DE PARTAGE EST LA PRÉSENCE D'UN TENDER, PAS `order_type = 'b2b'`.
-- Sur les données du jour les deux découpages coïncident, et c'est précisément
-- le piège : `get_payments_by_method_v3` compte les commandes qui ont une ligne
-- `order_payments`. Partager sur le type de commande ferait donc dériver les
-- deux côtés dès qu'une commande non-B2B serait réglée hors tender. Partagé sur
-- le tender, le rapprochement `total = tendered + on_account` est vrai PAR
-- CONSTRUCTION, pas par coïncidence de données.
--
-- Payload ADDITIF : `summary` gagne quatre clés, aucune n'est retirée ni
-- renommée. Les appelants qui ignorent les nouvelles continuent de fonctionner.
--
-- Corps repris du LIVE (`pg_get_functiondef`, projet ikcyvlovptebroadgtvd,
-- 2026-08-21), pas du fichier de migration d'origine.

CREATE OR REPLACE FUNCTION get_daily_sales_v3(p_date_start text, p_date_end text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_summary  JSONB;
  v_by_day   JSONB;
  v_sessions JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_orders AS (
    SELECT o.id,
           o.total,
           COALESCE(o.discount_amount, 0) + COALESCE(o.promotion_total, 0) AS discount,
           ((o.paid_at AT TIME ZONE v_tz))::date AS day,
           -- v3 : le canal de règlement. `EXISTS` et non un JOIN — une commande
           -- réglée en plusieurs tenders ne doit pas se compter deux fois.
           EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id = o.id) AS tendered
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  day_orders AS (
    SELECT vo.day,
           COUNT(*)::INT                AS order_count,
           SUM(vo.total)::NUMERIC(14,2) AS gross
      FROM valid_orders vo
     GROUP BY vo.day
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day,
           SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  days AS (
    SELECT COALESCE(o.day, r.day)                        AS day,
           COALESCE(o.order_count, 0)                    AS order_count,
           COALESCE(o.gross, 0)::NUMERIC(14,2)           AS gross,
           COALESCE(r.refund_total, 0)::NUMERIC(14,2)    AS refunds
      FROM day_orders o
      FULL OUTER JOIN day_refunds r ON r.day = o.day
  ),
  discounts AS (
    SELECT
      COALESCE(SUM(vo.discount), 0)::NUMERIC(14,2)  AS discount_total,
      COUNT(*) FILTER (WHERE vo.discount > 0)::INT   AS discount_orders_count
      FROM valid_orders vo
  ),
  -- v3 : la ventilation par canal de règlement. Somme sur le BRUT, pas sur le
  -- net : les remboursements ne se rattachent pas à un canal ici, et un
  -- rapprochement doit se lire `total = tendered + on_account`, puis
  -- `net = total - refund_total`. Deux soustractions honnêtes valent mieux
  -- qu'une ventilation qui prétendrait ventiler ce qu'elle ne sait pas.
  settlement AS (
    SELECT
      COALESCE(SUM(vo.total) FILTER (WHERE vo.tendered), 0)::NUMERIC(14,2)     AS tendered_total,
      COUNT(*) FILTER (WHERE vo.tendered)::INT                                  AS tendered_order_count,
      COALESCE(SUM(vo.total) FILTER (WHERE NOT vo.tendered), 0)::NUMERIC(14,2) AS on_account_total,
      COUNT(*) FILTER (WHERE NOT vo.tendered)::INT                              AS on_account_order_count
      FROM valid_orders vo
  ),
  voids AS (
    SELECT
      COUNT(*)::INT                            AS voids_count,
      COALESCE(SUM(o.total), 0)::NUMERIC(14,2) AS voids_value
      FROM orders o
     WHERE o.voided_at IS NOT NULL
       AND ((o.voided_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  )
  SELECT
    jsonb_build_object(
      'total',                 COALESCE(SUM(d.gross), 0),
      'order_count',           COALESCE(SUM(d.order_count), 0),
      'aov',                   CASE WHEN COALESCE(SUM(d.order_count), 0) = 0 THEN 0
                                    ELSE ROUND(SUM(d.gross) / SUM(d.order_count), 2) END,
      'refund_total',          COALESCE(SUM(d.refunds), 0),
      'net',                   COALESCE(SUM(d.gross), 0) - COALESCE(SUM(d.refunds), 0),
      'discount_total',        (SELECT discount_total FROM discounts),
      'discount_orders_count', (SELECT discount_orders_count FROM discounts),
      'voids_count',           (SELECT voids_count FROM voids),
      'voids_value',           (SELECT voids_value FROM voids),
      -- v3 — additif. Invariant opposable : total = tendered_total + on_account_total.
      'tendered_total',          (SELECT tendered_total FROM settlement),
      'tendered_order_count',    (SELECT tendered_order_count FROM settlement),
      'on_account_total',        (SELECT on_account_total FROM settlement),
      'on_account_order_count',  (SELECT on_account_order_count FROM settlement)
    ),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'date',        d.day,
        'order_count', d.order_count,
        'gross',       d.gross,
        'refunds',     d.refunds,
        'net',         d.gross - d.refunds,
        'aov',         CASE WHEN d.order_count = 0 THEN 0 ELSE ROUND(d.gross / d.order_count, 2) END
      ) ORDER BY d.day
    ), '[]'::jsonb)
  INTO v_summary, v_by_day
  FROM days d;

  -- Sessions chevauchant la fenêtre [v_start, v_end] : ouvertes avant/pendant
  -- la fin de fenêtre ET (encore ouvertes OU fermées après le début).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',             ps.id,
      'cashier',        up.full_name,
      'opened_at',      ps.opened_at,
      'opening_cash',   ps.opening_cash,
      'status',         ps.status::text,
      'closed_at',      ps.closed_at,
      'variance_total', ps.variance_total
    ) ORDER BY ps.opened_at
  ), '[]'::jsonb)
  INTO v_sessions
  FROM pos_sessions ps
  LEFT JOIN user_profiles up ON up.id = ps.opened_by
  WHERE ((ps.opened_at AT TIME ZONE v_tz))::date <= v_end
    AND (ps.closed_at IS NULL OR ((ps.closed_at AT TIME ZONE v_tz))::date >= v_start);

  RETURN jsonb_build_object(
    'period',   jsonb_build_object('start', v_start, 'end', v_end),
    'summary',  v_summary,
    'by_day',   v_by_day,
    'sessions', v_sessions
  );
END;
$function$;

COMMENT ON FUNCTION get_daily_sales_v3(text, text) IS
  'Bump de get_daily_sales_v2 (20260815000003). Ajoute la ventilation par canal '
  'de reglement dans summary : tendered_total/tendered_order_count (commandes '
  'portant au moins une ligne order_payments) et on_account_total/'
  'on_account_order_count (le reste, typiquement le B2B regle au grand livre AR). '
  'Invariant : total = tendered_total + on_account_total. Le partage se fait sur '
  'la PRESENCE D UN TENDER et non sur order_type, pour que le rapprochement avec '
  'get_payments_by_method_v3 soit vrai par construction et non par coincidence de '
  'donnees. Payload additif, aucune cle retiree. Gate : reports.sales.read.';

-- ─── GRANT + trio REVOKE canonique ──────────────────────────────────────────
-- Bénéficiaires relevés sur le LIVE pour v2 (information_schema.role_routine_grants) :
-- authenticated, postgres (proprietaire), service_role. Aucune ligne PUBLIC.
GRANT EXECUTE ON FUNCTION get_daily_sales_v3(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_sales_v3(text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION get_daily_sales_v3(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_daily_sales_v3(text, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ─── DROP de la version supplantee (versioning monotone) ────────────────────
-- Appelants repointes dans le meme changement : useDailySales.ts, et les suites
-- pgTAP s40_reports / net_revenue_full_void / payments_by_method_v3_timezone.
DROP FUNCTION get_daily_sales_v2(text, text);
