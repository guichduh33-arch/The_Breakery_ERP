-- S3-06 — Frais de livraison et escomptes sur les bons de commande.
--
-- Règle (SPECS, section achats) : le port et les escomptes (global et par
-- ligne) existent ; le port est réparti au prorata sur les lignes.
--
-- Modèle retenu :
--   * ligne  : `discount_amount` = escompte en montant (IDR) sur la ligne ;
--              net de ligne = round(quantité × coût unitaire, 2) − escompte.
--   * bon    : `subtotal`        = Σ nets de ligne (après escomptes de ligne) ;
--              `discount_amount` = escompte global, en montant ;
--              `vat_amount`      = round((subtotal − escompte global) × taux, 2) ;
--              `delivery_fee`    = port tel que facturé (aucune PPN ajoutée) ;
--              `total_amount`    = subtotal − escompte global + PPN + port.
--   * L'escompte global, la PPN et le port se répartissent sur les lignes par
--     la méthode du plus fort reste, au centime : la somme des parts égale
--     EXACTEMENT le montant réparti (aucune perte d'arrondi). Poids : le net de
--     ligne (la PPN : la base taxable de ligne). Poids tous nuls : parts égales.
--   * La réception valorise chaque ligne à sa part du total du bon (PPN non
--     récupérable, escomptes et port compris : NON-PKP, ADR-005), en
--     différence cumulée : la somme des réceptions d'une ligne entièrement
--     reçue égale exactement sa part. Le coût moyen (WAC) reçoit ce coût.
--   * L'écriture de réception (déclencheur `create_purchase_journal_entry`)
--     reste inchangée : elle débite le stock de subtotal + PPN du GRN et
--     crédite la dette du total ; le GRN porte désormais port et escomptes.
--
-- Ce fichier est la partie 1 sur 4 (colonnes et ventilation). Les bumps vivent
-- dans 20261120000031 à 20261120000033, découpés pour passer par le MCP.
-- Bumps (corps live `pg_get_functiondef` du 2026-11-20) :
--   create_purchase_order_v2  → v3 (deux arguments en fin, par défaut 0)
--   update_purchase_order_v1  → v2 (mêmes arguments, nouvelles clés de patch)
--   receive_purchase_order_v7 → v8 (mêmes arguments)

-- ---------------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN delivery_fee    numeric(14,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT purchase_orders_discount_amount_check CHECK (discount_amount >= 0),
  ADD CONSTRAINT purchase_orders_delivery_fee_check    CHECK (delivery_fee >= 0);

ALTER TABLE public.purchase_order_items
  ADD COLUMN discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT purchase_order_items_discount_amount_check CHECK (discount_amount >= 0);

COMMENT ON COLUMN public.purchase_orders.discount_amount IS
  'S3-06 : escompte global du bon, en montant. Réparti au prorata des nets de ligne.';
COMMENT ON COLUMN public.purchase_orders.delivery_fee IS
  'S3-06 : frais de livraison facturés, sans PPN ajoutée. Répartis au prorata des nets de ligne et capitalisés dans le coût du stock.';
COMMENT ON COLUMN public.purchase_order_items.discount_amount IS
  'S3-06 : escompte de la ligne, en montant, déduit de quantité × coût unitaire.';

-- ---------------------------------------------------------------------------
-- 2. Répartition exacte au plus fort reste (au centime)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._split_pro_rata_v1(p_amount numeric, p_weights numeric[])
RETURNS numeric[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n       int := COALESCE(array_length(p_weights, 1), 0);
  v_cents   bigint;
  v_weights numeric[];
  v_total   numeric;
  v_out     numeric[];
BEGIN
  IF v_n = 0 THEN
    RETURN ARRAY[]::numeric[];
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'split_amount_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_cents := round(p_amount * 100)::bigint;

  -- Poids négatifs ou absents : zéro. Tous nuls : parts égales.
  SELECT array_agg(GREATEST(COALESCE(w, 0), 0) ORDER BY i) INTO v_weights
    FROM unnest(p_weights) WITH ORDINALITY AS u(w, i);
  SELECT sum(w) INTO v_total FROM unnest(v_weights) AS w;
  IF v_total = 0 THEN
    v_weights := array_fill(1::numeric, ARRAY[v_n]);
    v_total   := v_n;
  END IF;

  -- Plus fort reste : chaque part reçoit la partie entière de ses centimes,
  -- les centimes restants vont aux plus grandes fractions (ex aequo : rang).
  WITH base AS (
    SELECT i,
           floor(v_cents * w / v_total)::bigint                       AS f,
           (v_cents * w / v_total) - floor(v_cents * w / v_total)     AS frac
      FROM unnest(v_weights) WITH ORDINALITY AS u(w, i)
  ), leftover AS (
    SELECT v_cents - sum(f) AS n FROM base
  ), ranked AS (
    SELECT b.i, b.f, row_number() OVER (ORDER BY b.frac DESC, b.i) AS rn
      FROM base b
  )
  SELECT array_agg(
           ((r.f + CASE WHEN r.rn <= l.n THEN 1 ELSE 0 END)::numeric / 100)::numeric(14,2)
           ORDER BY r.i)
    INTO v_out
    FROM ranked r CROSS JOIN leftover l;

  RETURN v_out;
END $function$;

COMMENT ON FUNCTION public._split_pro_rata_v1(numeric, numeric[]) IS
  'S3-06 : répartit un montant au prorata des poids, au centime, par le plus fort reste. La somme des parts égale exactement le montant.';

REVOKE EXECUTE ON FUNCTION public._split_pro_rata_v1(numeric, numeric[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._split_pro_rata_v1(numeric, numeric[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public._split_pro_rata_v1(numeric, numeric[]) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ventilation d'un bon par ligne
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._po_cost_allocation_v1(p_po_id uuid)
RETURNS TABLE (
  po_item_id     uuid,
  line_gross     numeric,
  line_discount  numeric,
  line_net       numeric,
  discount_share numeric,
  vat_share      numeric,
  fee_share      numeric,
  line_total     numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_po    RECORD;
  v_ids   uuid[];
  v_gross numeric[];
  v_ldisc numeric[];
  v_net   numeric[];
  v_dsh   numeric[];
  v_tax   numeric[];
  v_vsh   numeric[];
  v_fsh   numeric[];
BEGIN
  SELECT po.discount_amount, po.delivery_fee, po.vat_amount INTO v_po
    FROM purchase_orders po WHERE po.id = p_po_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Ordre stable : création, puis identifiant.
  SELECT array_agg(i.id ORDER BY i.created_at, i.id),
         array_agg(round(i.quantity * i.unit_cost, 2) ORDER BY i.created_at, i.id),
         array_agg(i.discount_amount ORDER BY i.created_at, i.id)
    INTO v_ids, v_gross, v_ldisc
    FROM purchase_order_items i WHERE i.po_id = p_po_id;
  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(g - d ORDER BY k) INTO v_net
    FROM unnest(v_gross, v_ldisc) WITH ORDINALITY AS u(g, d, k);
  v_dsh := _split_pro_rata_v1(v_po.discount_amount, v_net);
  SELECT array_agg(n - s ORDER BY k) INTO v_tax
    FROM unnest(v_net, v_dsh) WITH ORDINALITY AS u(n, s, k);
  v_vsh := _split_pro_rata_v1(v_po.vat_amount, v_tax);
  v_fsh := _split_pro_rata_v1(v_po.delivery_fee, v_net);

  RETURN QUERY
    SELECT u.id, u.g, u.d, u.n, u.ds, u.vs, u.fs, (u.n - u.ds + u.vs + u.fs)
      FROM unnest(v_ids, v_gross, v_ldisc, v_net, v_dsh, v_vsh, v_fsh)
           AS u(id, g, d, n, ds, vs, fs);
END $function$;

COMMENT ON FUNCTION public._po_cost_allocation_v1(uuid) IS
  'S3-06 : part de chaque ligne dans l''escompte global, la PPN et le port du bon. Σ line_total = total_amount du bon.';

REVOKE EXECUTE ON FUNCTION public._po_cost_allocation_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._po_cost_allocation_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._po_cost_allocation_v1(uuid) FROM authenticated;

