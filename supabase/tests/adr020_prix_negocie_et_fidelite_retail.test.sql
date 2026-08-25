-- supabase/tests/adr020_prix_negocie_et_fidelite_retail.test.sql
-- ADR-020 décisions 4 et 5.
--
-- DÉCISION 4 — le prix négocié par client fait autorité sur TOUS les chemins
-- d'encaissement. A1 à A3 sont les trois cas que l'ADR exige nommément ; A5 est
-- l'invariant qu'il installe : le money-path et le chemin B2B ne peuvent plus
-- diverger, puisqu'ils partagent désormais un seul résolveur.
--
-- DÉCISION 5 — la fidélité est un dispositif retail, et la catégorie peut la
-- désactiver. B1 à B4 vérifient que le refus d'acquisition ne fait pas perdre
-- les compteurs de fréquentation : un compte B2B reste suivi, il n'accumule
-- simplement plus de points convertibles en avoir monétaire.
--
-- Run via MCP execute_sql (enveloppe BEGIN..ROLLBACK portée par ce fichier).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- ─────────────────────────────────────────────────────────────────────────────
-- Décor
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_actor    UUID;
  v_profile  UUID;
  v_cat_prod UUID;
  v_prod     UUID;
  v_cat_cust UUID;   -- categorie client 'custom' (grille par categorie)
  v_cat_ret  UUID;   -- categorie client retail, fidelite ACTIVE
  v_cat_off  UUID;   -- categorie client retail, fidelite DESACTIVEE
  v_c_nego   UUID;   -- B2B avec prix negocie
  v_c_grille UUID;   -- B2B sans negocie, categorie custom
  v_c_retail UUID;   -- retail
  v_c_b2b    UUID;   -- B2B, pour la fidelite
  v_c_off    UUID;   -- retail dont la categorie a loyalty_enabled = false
BEGIN
  -- Acteur : selectionne sur les PERMISSIONS, pas sur le role_code, et ordonne
  -- pour ne pas devenir intermittent (lecon du 2026-08-03 : un LIMIT 1 sans
  -- ORDER BY piochait SYS-CRON, inactif et sans compte auth).
  SELECT up.auth_user_id, up.id INTO v_actor, v_profile
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.is_active AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'payments.process')
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   ORDER BY up.employee_code LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Aucun profil actif porteur de payments.process + pos.sale.create';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  SELECT id INTO v_cat_prod FROM categories WHERE deleted_at IS NULL ORDER BY name LIMIT 1;

  INSERT INTO products (sku, name, category_id, retail_price, wholesale_price, cost_price,
                        unit, current_stock, track_inventory, product_type)
    VALUES ('TST-ADR020D', 'ADR020 Prix Item', v_cat_prod, 10000, 9000, 4000,
            'pcs', 1000, true, 'finished')
    RETURNING id INTO v_prod;

  -- ── Categories clients ──────────────────────────────────────────────────
  INSERT INTO customer_categories (name, slug, price_modifier_type, loyalty_enabled)
    VALUES ('ADR020 Custom', 'adr020-custom', 'custom', true) RETURNING id INTO v_cat_cust;
  INSERT INTO customer_categories (name, slug, price_modifier_type, loyalty_enabled)
    VALUES ('ADR020 Retail', 'adr020-retail', 'retail', true) RETURNING id INTO v_cat_ret;
  INSERT INTO customer_categories (name, slug, price_modifier_type, loyalty_enabled)
    VALUES ('ADR020 Sans Fidelite', 'adr020-sans-fidelite', 'retail', false) RETURNING id INTO v_cat_off;

  -- Grille PAR CATEGORIE : 7300 pour la categorie custom.
  INSERT INTO product_category_prices (product_id, customer_category_id, price)
    VALUES (v_prod, v_cat_cust, 7300);

  -- ── Clients ─────────────────────────────────────────────────────────────
  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 Nego', 'b2b', v_cat_cust) RETURNING id INTO v_c_nego;
  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 Grille', 'b2b', v_cat_cust) RETURNING id INTO v_c_grille;
  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 Retail', 'retail', v_cat_ret) RETURNING id INTO v_c_retail;
  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 B2B Fid', 'b2b', v_cat_ret) RETURNING id INTO v_c_b2b;
  INSERT INTO customers (name, customer_type, category_id)
    VALUES ('ADR020 Retail SansFid', 'retail', v_cat_off) RETURNING id INTO v_c_off;

  -- Prix NEGOCIE par client : 4200, sous le prix de la grille comme du retail.
  INSERT INTO customer_product_prices (customer_id, product_id, price)
    VALUES (v_c_nego, v_prod, 4200);

  PERFORM set_config('adr020d.prod',     v_prod::text,     true);
  PERFORM set_config('adr020d.c_nego',   v_c_nego::text,   true);
  PERFORM set_config('adr020d.c_grille', v_c_grille::text, true);
  PERFORM set_config('adr020d.c_retail', v_c_retail::text, true);
  PERFORM set_config('adr020d.c_b2b',    v_c_b2b::text,    true);
  PERFORM set_config('adr020d.c_off',    v_c_off::text,    true);
  PERFORM set_config('adr020d.actor',    v_actor::text,    true);
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- A — Prix négocié (décision 4)
-- ═════════════════════════════════════════════════════════════════════════════

-- A1: le prix négocié par client prime sur la grille par catégorie ET sur le
--     retail. C'est le cas que le money-path ignorait : il ne consultait que la
--     grille, donc facturait 7300 là où le BackOffice facturait 4200.
DO $$ DECLARE v_p NUMERIC; BEGIN
  SELECT unit_price INTO v_p FROM _resolve_line_price_v2(
    current_setting('adr020d.prod')::uuid, 1, '[]'::jsonb,
    current_setting('adr020d.c_nego')::uuid, false, false);
  INSERT INTO _r VALUES ('a1_negocie', v_p = 4200);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('a1_negocie', false); END $$;

-- A2: sans prix négocié, la grille par catégorie ('custom') s'applique.
DO $$ DECLARE v_p NUMERIC; BEGIN
  SELECT unit_price INTO v_p FROM _resolve_line_price_v2(
    current_setting('adr020d.prod')::uuid, 1, '[]'::jsonb,
    current_setting('adr020d.c_grille')::uuid, false, false);
  INSERT INTO _r VALUES ('a2_categorie', v_p = 7300);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('a2_categorie', false); END $$;

-- A3: un client retail paie le prix retail.
DO $$ DECLARE v_p NUMERIC; BEGIN
  SELECT unit_price INTO v_p FROM _resolve_line_price_v2(
    current_setting('adr020d.prod')::uuid, 1, '[]'::jsonb,
    current_setting('adr020d.c_retail')::uuid, false, false);
  INSERT INTO _r VALUES ('a3_retail', v_p = 10000);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('a3_retail', false); END $$;

-- A4: sans client (vente anonyme au comptoir), prix retail — inchangé.
DO $$ DECLARE v_p NUMERIC; v_sub NUMERIC; BEGIN
  SELECT unit_price, line_subtotal INTO v_p, v_sub FROM _resolve_line_price_v2(
    current_setting('adr020d.prod')::uuid, 3, '[]'::jsonb, NULL, false, false);
  INSERT INTO _r VALUES ('a4_anonyme', v_p = 10000 AND v_sub = 30000);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('a4_anonyme', false); END $$;

-- A5: L'INVARIANT de l'ADR — money-path et chemin B2B rendent le MÊME prix de
--     base pour le même couple (client, produit), sur les trois profils. C'est
--     ce que garantit le partage d'un unique résolveur : la divergence n'est
--     plus une regression possible, elle est structurellement exclue.
DO $$ DECLARE v_ecarts INT; BEGIN
  SELECT count(*) INTO v_ecarts
    FROM (VALUES (current_setting('adr020d.c_nego')::uuid),
                 (current_setting('adr020d.c_grille')::uuid),
                 (current_setting('adr020d.c_retail')::uuid)) AS c(id)
   WHERE (SELECT unit_price FROM _resolve_line_price_v2(
             current_setting('adr020d.prod')::uuid, 1, '[]'::jsonb, c.id, false, false))
      IS DISTINCT FROM
         _resolve_b2b_line_price_v1(c.id, current_setting('adr020d.prod')::uuid);
  INSERT INTO _r VALUES ('a5_parite', v_ecarts = 0);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('a5_parite', false); END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B — Périmètre de la fidélité (décision 5)
-- ═════════════════════════════════════════════════════════════════════════════

-- Un encaissement complet par client : commande comptoir fired, puis payée.
CREATE OR REPLACE FUNCTION pg_temp._encaisse(p_customer UUID, p_tag TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_session UUID;
  v_order   UUID;
  v_items   NUMERIC;
  v_total   NUMERIC;
  v_env     JSONB;
BEGIN
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    SELECT up.id, 0, 'closed' FROM user_profiles up
     WHERE up.auth_user_id = current_setting('adr020d.actor')::uuid
    RETURNING id INTO v_session;

  v_env := fire_counter_order_v7(
    p_client_uuid  := gen_random_uuid(),
    p_session_id   := v_session,
    p_items        := jsonb_build_array(jsonb_build_object(
                        'product_id', current_setting('adr020d.prod'),
                        'quantity', 5, 'unit_price', 10000, 'modifiers', '[]'::jsonb)),
    p_order_type   := 'take_out'::order_type);
  v_order := (v_env->>'order_id')::uuid;

  -- `orders.total` vaut 0 apres un fire : les totaux ne sont poses qu'au
  -- paiement. On calcule le montant du reglement comme le fait le money-path,
  -- via _pb1_split_v1 sur les lignes persistees — sinon la RPC refuse le tender
  -- (« amount must be > 0 »).
  SELECT COALESCE(SUM(line_total), 0) INTO v_items FROM order_items WHERE order_id = v_order;
  SELECT s.total INTO v_total FROM _pb1_split_v1(v_items) s;

  PERFORM pay_existing_order_v18(
    p_order_id   := v_order,
    p_payment    := jsonb_build_object('method', 'cash', 'amount', v_total,
                                       'cash_received', v_total, 'change_given', 0),
    p_customer_id := p_customer);

  PERFORM set_config('adr020d.order_' || p_tag, v_order::text, true);
END $$;

-- B1: retail, catégorie avec loyalty_enabled -> des points sont acquis et le
--     ledger porte une ligne 'earn'.
DO $$ DECLARE v_pts INT; v_earn INT; BEGIN
  PERFORM pg_temp._encaisse(current_setting('adr020d.c_retail')::uuid, 'retail');
  SELECT loyalty_points INTO v_pts FROM customers WHERE id = current_setting('adr020d.c_retail')::uuid;
  SELECT count(*) INTO v_earn FROM loyalty_transactions
   WHERE customer_id = current_setting('adr020d.c_retail')::uuid AND transaction_type = 'earn';
  INSERT INTO _r VALUES ('b1_retail_gagne', v_pts > 0 AND v_earn = 1);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('b1_retail_gagne', false); END $$;

-- B2: B2B -> aucun point, aucune ligne au ledger. C'est le défaut que l'ADR
--     ferme : un compte B2B à fort volume accumulait des points convertibles en
--     avoir monétaire, EN PLUS de son prix wholesale.
DO $$ DECLARE v_pts INT; v_earn INT; BEGIN
  PERFORM pg_temp._encaisse(current_setting('adr020d.c_b2b')::uuid, 'b2b');
  SELECT loyalty_points INTO v_pts FROM customers WHERE id = current_setting('adr020d.c_b2b')::uuid;
  SELECT count(*) INTO v_earn FROM loyalty_transactions
   WHERE customer_id = current_setting('adr020d.c_b2b')::uuid AND transaction_type = 'earn';
  INSERT INTO _r VALUES ('b2_b2b_zero', v_pts = 0 AND v_earn = 0);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('b2_b2b_zero', false); END $$;

-- B3: le compte B2B garde ses compteurs de fréquentation — le refus porte sur
--     les points, pas sur le suivi client.
DO $$ DECLARE v_visits INT; v_spent NUMERIC; BEGIN
  SELECT total_visits, total_spent INTO v_visits, v_spent
    FROM customers WHERE id = current_setting('adr020d.c_b2b')::uuid;
  INSERT INTO _r VALUES ('b3_compteurs_tenus', v_visits = 1 AND v_spent > 0);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('b3_compteurs_tenus', false); END $$;

-- B4: retail dont la catégorie a loyalty_enabled = false -> aucun point, mais
--     compteurs tenus eux aussi.
DO $$ DECLARE v_pts INT; v_earn INT; v_visits INT; BEGIN
  PERFORM pg_temp._encaisse(current_setting('adr020d.c_off')::uuid, 'off');
  SELECT loyalty_points, total_visits INTO v_pts, v_visits
    FROM customers WHERE id = current_setting('adr020d.c_off')::uuid;
  SELECT count(*) INTO v_earn FROM loyalty_transactions
   WHERE customer_id = current_setting('adr020d.c_off')::uuid AND transaction_type = 'earn';
  INSERT INTO _r VALUES ('b4_flag_respecte', v_pts = 0 AND v_earn = 0 AND v_visits = 1);
EXCEPTION WHEN OTHERS THEN INSERT INTO _r VALUES ('b4_flag_respecte', false); END $$;

SELECT plan(9);
CREATE TEMP TABLE _cap(l TEXT);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='a1_negocie'),  'A1: prix negocie par client (4200) prime sur la grille par categorie et sur le retail');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='a2_categorie'),'A2: sans negocie, la grille par categorie custom (7300) s applique');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='a3_retail'),   'A3: client retail -> prix retail (10000)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='a4_anonyme'),  'A4: vente sans client -> retail, line_subtotal = qty x prix');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='a5_parite'),   'A5: money-path et chemin B2B rendent le meme prix de base sur les 3 profils (resolveur unique)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='b1_retail_gagne'),   'B1: retail + loyalty_enabled -> points acquis + 1 ligne earn au ledger');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='b2_b2b_zero'),       'B2: client B2B -> aucun point, aucune ligne earn');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='b3_compteurs_tenus'),'B3: le B2B garde total_visits et total_spent — le refus porte sur les points seuls');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='b4_flag_respecte'),  'B4: retail en categorie loyalty_enabled=false -> aucun point, compteurs tenus');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _cap;
SELECT * FROM finish();

ROLLBACK;
