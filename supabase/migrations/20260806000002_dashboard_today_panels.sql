-- 20260806000002_dashboard_today_panels.sql
--
-- Les trois panneaux de l'écran 1c qui ne vivent PAS dans l'agrégat
-- get_dashboard_overview_v2 (migration 20260806000001).
--
-- Séparés parce que chacun a sa propre cadence ET son propre droit, et que les
-- mêler à l'agrégat aurait deux effets pervers : un poll 60 s sur des données
-- qui doivent être realtime, et une barrière `reports.read` qui masquerait
-- l'état du plancher à un caissier qui a pourtant `orders.read`.

-- ═══════════════════════════════════════════════════════════════════════════
-- « Open orders » — état du plancher, rafraîchi en realtime.
--
-- La DESTINATION est reconstruite selon le type : la table pour un dine_in,
-- « Take-away », « Delivery », ou le nom du client pour un b2b. Le handoff
-- dessinait « Delivery · Gojek » : `orders` ne porte AUCUNE colonne de canal
-- de livraison, ce libellé n'a donc pas de source et se réduit à « Delivery ».
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_dashboard_open_orders_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows  JSONB;
  v_total NUMERIC;
  v_count INT;
  v_late  INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'orders.read') THEN
    RAISE EXCEPTION 'permission denied: orders.read required'
      USING ERRCODE = '42501';
  END IF;

  WITH open_orders AS (
    SELECT o.id, o.order_number, o.order_type, o.total,
           EXTRACT(EPOCH FROM (now() - o.created_at)) / 60 AS minutes_open,
           CASE o.order_type
             WHEN 'dine_in'  THEN COALESCE(NULLIF(btrim(o.table_number), ''), 'Dine-in')
             WHEN 'take_out' THEN 'Take-away'
             WHEN 'delivery' THEN 'Delivery'
             WHEN 'b2b'      THEN COALESCE(NULLIF(btrim(c.b2b_company_name), ''), c.name, 'B2B')
           END AS destination
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.status IN ('draft', 'pending_payment')
       AND o.voided_at IS NULL
       AND o.is_held IS NOT TRUE
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           oo.id,
           'order_number', oo.order_number,
           'order_type',   oo.order_type,
           'destination',  oo.destination,
           'total',        oo.total,
           'minutes_open', ROUND(oo.minutes_open)
         ) ORDER BY oo.minutes_open DESC), '[]'::jsonb),
         COALESCE(SUM(oo.total), 0),
         COUNT(*)::INT,
         COUNT(*) FILTER (WHERE oo.minutes_open > 45)::INT
    INTO v_rows, v_total, v_count, v_late
    FROM open_orders oo;

  RETURN jsonb_build_object(
    'orders',        v_rows,
    'open_count',    v_count,
    'open_total',    v_total,
    'over_45_count', v_late,
    'generated_at',  now()
  );
END;
$function$;

COMMENT ON FUNCTION public.get_dashboard_open_orders_v1() IS
  'Panneau « Open orders » du dashboard Today. Commandes draft/pending_payment '
  'non voidées et non mises en attente, avec destination reconstruite et âge en '
  'minutes. Gate orders.read.';

REVOKE ALL ON FUNCTION public.get_dashboard_open_orders_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_open_orders_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_open_orders_v1() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- « Display stock · vitrine » — compteur + temps depuis la dernière vente.
--
-- Le handoff annonçait qu'il faudrait « un horodatage de dernière vente par
-- produit » : il est DÉRIVABLE de order_items ⋈ orders.paid_at, aucune table
-- ni colonne nouvelle n'est nécessaire.
--
-- Lecture SEULE : le compteur vitrine n'est muté que par le POS.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_display_stock_activity_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows  JSONB;
  v_empty INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'display.read') THEN
    RAISE EXCEPTION 'permission denied: display.read required'
      USING ERRCODE = '42501';
  END IF;

  WITH last_sale AS (
    SELECT oi.product_id, MAX(o.paid_at) AS last_sold_at
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND NOT oi.is_cancelled
       AND o.paid_at > now() - interval '7 days'
     GROUP BY oi.product_id
  ),
  shelf AS (
    SELECT p.id, p.name, p.sku, p.unit, ds.quantity, p.min_stock_threshold,
           ls.last_sold_at
      FROM display_stock ds
      JOIN products p ON p.id = ds.product_id
      LEFT JOIN last_sale ls ON ls.product_id = ds.product_id
     WHERE p.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',    s.id,
           'product_name',  s.name,
           'sku',           s.sku,
           'unit',          s.unit,
           'quantity',      s.quantity,
           'min_threshold', s.min_stock_threshold,
           'last_sold_at',  s.last_sold_at,
           'minutes_since_sale',
             CASE WHEN s.last_sold_at IS NULL THEN NULL
                  ELSE ROUND(EXTRACT(EPOCH FROM (now() - s.last_sold_at)) / 60) END
         ) ORDER BY s.last_sold_at DESC NULLS LAST), '[]'::jsonb),
         COUNT(*) FILTER (WHERE s.quantity <= 0)::INT
    INTO v_rows, v_empty
    FROM shelf s;

  RETURN jsonb_build_object(
    'rows',         v_rows,
    'empty_count',  v_empty,
    'generated_at', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.get_display_stock_activity_v1() IS
  'Panneau vitrine du dashboard Today : compteur display_stock + temps depuis la '
  'dernière vente (dérivé de order_items, fenêtre 7 j). Lecture seule — le '
  'compteur n''est muté que par le POS. Gate display.read.';

REVOKE ALL ON FUNCTION public.get_display_stock_activity_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_display_stock_activity_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_display_stock_activity_v1() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- « Needs you » — la file d'actions, 5 sources agrégées.
--
-- C'est le cœur de l'écran 1c : mettre le travail à faire AU-DESSUS des
-- chiffres. Chaque ligne est un fait vérifiable, avec sa destination de
-- résolution ; rien ne se « marque comme lu », une ligne disparaît quand le
-- fait qui la produit disparaît.
--
-- Filtrage par droit, source par source : un caissier n'a aucune de ces
-- permissions et voit donc une file VIDE, pas une file d'items inertes.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_dashboard_action_queue_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_tz    TEXT;
  v_today DATE;
  v_items JSONB := '[]'::jsonb;
  v_n     INT;
  v_date  DATE;
  v_days  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'permission denied: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- 1. Caisse non clôturée — bloquant : tant qu'un shift d'un jour passé reste
  --    ouvert, le Z-report de ce jour n'existe pas et la compta est en retard.
  IF has_permission(v_uid, 'zreports.read') THEN
    SELECT COUNT(*)::INT, MIN(((s.opened_at AT TIME ZONE v_tz))::date)
      INTO v_n, v_date
      FROM pos_sessions s
     WHERE s.status = 'open'
       AND ((s.opened_at AT TIME ZONE v_tz))::date < v_today;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'register_not_closed', 'severity', 'blocking', 'count', v_n,
        'label', CASE WHEN v_n = 1
                      THEN 'Register not closed - ' || to_char(v_date, 'DD Mon')
                      ELSE v_n || ' registers not closed since ' || to_char(v_date, 'DD Mon') END,
        'action', 'Reconcile', 'to', '/backoffice/cash-register/zreports');
    END IF;
  END IF;

  -- 2 & 3. Stock — sous le minimum, puis à réapprovisionner. Les deux RPC
  --        portent la même barrière inventory.read qu'on vient de vérifier.
  IF has_permission(v_uid, 'inventory.read') THEN
    SELECT COUNT(*)::INT INTO v_n FROM get_low_stock_v1();
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'low_stock', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below minimum stock',
        'action', 'Review', 'to', '/backoffice/inventory/alerts');
    END IF;

    SELECT COUNT(*)::INT INTO v_n FROM get_reorder_suggestions_v1(30, 14);
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'reorder', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below reorder point',
        'action', 'Create PO', 'to', '/backoffice/purchasing/purchase-orders/new');
    END IF;
  END IF;

  -- 4. Bons de commande en attente de réception.
  IF has_permission(v_uid, 'purchasing.po.read') THEN
    SELECT COUNT(*)::INT INTO v_n
      FROM purchase_orders po
     WHERE po.status IN ('pending', 'partial')
       AND po.deleted_at IS NULL;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'po_awaiting_receipt', 'severity', 'info', 'count', v_n,
        'label', v_n || ' PO' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' awaiting receipt',
        'action', 'Receive', 'to', '/backoffice/purchasing/purchase-orders');
    END IF;
  END IF;

  -- 5. Factures B2B en retard. Aucune colonne d'échéance sur `orders` :
  --    l'échéance se reconstruit depuis les termes du client, et à défaut
  --    depuis le défaut paramétré dans b2b_settings.
  IF has_permission(v_uid, 'b2b.read') THEN
    SELECT COUNT(*)::INT,
           MAX(v_today - (((o.created_at AT TIME ZONE v_tz))::date
               + COALESCE(c.b2b_payment_terms_days, bs.default_payment_terms, 30)))
      INTO v_n, v_days
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN b2b_settings bs ON TRUE
     WHERE o.order_type = 'b2b'
       AND o.status = 'b2b_pending'
       AND o.voided_at IS NULL
       AND ((o.created_at AT TIME ZONE v_tz))::date
           + COALESCE(c.b2b_payment_terms_days, bs.default_payment_terms, 30) < v_today;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'b2b_overdue', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' B2B invoice' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' overdue - up to ' || v_days || ' d',
        'action', 'Open', 'to', '/backoffice/b2b/payments');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE((SELECT SUM((i->>'count')::INT)
                         FROM jsonb_array_elements(v_items) i), 0)::INT,
    'generated_at', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.get_dashboard_action_queue_v1() IS
  'File « Needs you » du dashboard Today : caisses non clôturées, stock sous '
  'minimum, réappro suggéré, PO à réceptionner, factures B2B en retard. Chaque '
  'source est filtrée par son propre droit — un rôle sans aucun de ces droits '
  'reçoit une file vide. Aucun item ne se marque comme lu : il disparaît quand '
  'le fait disparaît.';

REVOKE ALL ON FUNCTION public.get_dashboard_action_queue_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_action_queue_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_action_queue_v1() TO authenticated;
