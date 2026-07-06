# S63 — Dashboard BO réel : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Câbler la page d'accueil du BackOffice (stub à zéros) sur un nouveau RPC agrégé `get_dashboard_overview_v1` — 5 KPIs réels + 5 panneaux graphiques.

**Architecture:** Un RPC unique SECURITY DEFINER (lecture pure, gate `reports.read`, bucketing `business_config.timezone`) renvoie toute l'enveloppe jsonb en un round-trip ; un hook React Query `useDashboardOverview` (polling 60 s) alimente `Dashboard.tsx` ; 5 composants panneaux (recharts + listes) dans une nouvelle feature `dashboard`.

**Tech Stack:** PostgreSQL/plpgsql (Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP), pgTAP-style DO-block suite, React 18 + TanStack Query + recharts `^2.13`, Vitest + Testing Library.

**Spec :** `docs/superpowers/specs/2026-07-06-s63-dashboard-overview-design.md` (validée). **Branche :** `swarm/session-63` (déjà créée, spec commitée).

## Global Constraints

- **DB = Supabase cloud, PAS de Docker** : migrations via `mcp__plugin_supabase_supabase__apply_migration` (`project_id='ikcyvlovptebroadgtvd'`), SQL/pgTAP via `execute_sql`, types via `generate_typescript_types`. JAMAIS `supabase start`/`db reset`/`run_pgtap.sh`.
- **Jamais de `BEGIN;`/`COMMIT;` dans le corps d'une migration** (le MCP wrappe déjà).
- **Migration `20260710000113`** — le plus haut NAME-block actuel est `_112` (re-vérifier `ls supabase/migrations | sort | tail -1` avant apply).
- **Trio S20 obligatoire** sur le RPC : `REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM anon` + `GRANT EXECUTE TO authenticated` + `COMMENT ON FUNCTION`.
- **Regen types après la migration** → `packages/supabase/src/types.generated.ts`, committé (cause n°1 de CI cassée).
- **Money-path intouchée** : RPC de lecture pure ; aucun RPC de vente modifié, aucune écriture.
- **pnpm 9.15 + turbo, jamais npm.** Fichiers < 500 lignes. Commits conventionnels co-signés `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **DB dev non vide** : toutes les assertions pgTAP sur les KPIs sont **en delta** (baseline capturé avant seed).

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260710000113_create_get_dashboard_overview_v1.sql` | Create : le RPC + trio S20 |
| `supabase/tests/dashboard_overview.test.sql` | Create : suite DO-block 14 assertions (enveloppe BEGIN..ROLLBACK) |
| `packages/supabase/src/types.generated.ts` | Regen après migration |
| `apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts` | Create : hook + types de l'enveloppe + classifieur d'erreur |
| `apps/backoffice/src/features/dashboard/components/RevenueTrendChart.tsx` | Create : LineChart 30 j |
| `apps/backoffice/src/features/dashboard/components/RevenueByTypeDonut.tsx` | Create : donut par type |
| `apps/backoffice/src/features/dashboard/components/HourlySalesChart.tsx` | Create : BarChart 0-23 (heures manquantes → 0 côté client) |
| `apps/backoffice/src/features/dashboard/components/TopProductsList.tsx` | Create : liste top 5 |
| `apps/backoffice/src/features/dashboard/components/PaymentMethodsList.tsx` | Create : liste + part % |
| `apps/backoffice/src/pages/Dashboard.tsx` | Modify : câblage hook + état « accès restreint » + panneaux |
| `apps/backoffice/src/pages/__tests__/Dashboard.test.tsx` | Modify : nouvelle forme d'enveloppe + nouveaux états |

Faits vérifiés (2026-07-06, types regénérés S62 + migrations locales) : `order_items.is_cancelled boolean` / `name_snapshot` / `line_total` / `quantity` ; `order_payments(amount, method enum payment_method, paid_at, order_id)` ; enum `payment_method` = `cash|card|qris|edc|transfer|store_credit` ; enum `order_type` = `dine_in|take_out|delivery|b2b` ; `refunds` exige `refund_number, reason, total, refunded_by, authorized_by, session_id` ; permission `reports.read` existe (gate du hub) ; définition « commande valide » = miroir `get_daily_sales_v1` (`20260624000011`).

---

### Task 1 : RPC `get_dashboard_overview_v1` + suite pgTAP

**Files:**
- Create: `supabase/tests/dashboard_overview.test.sql`
- Create: `supabase/migrations/20260710000113_create_get_dashboard_overview_v1.sql`
- Regen: `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Consumes: `has_permission(uuid, text)`, `business_config.timezone`, tables `orders`/`order_items`/`order_payments`/`refunds`.
- Produces: `public.get_dashboard_overview_v1() RETURNS JSONB` — enveloppe `{ kpis:{revenue_today,orders_today,items_sold,avg_basket,customers_today}, revenue_30d:[{date,net,order_count}], revenue_by_type:[{order_type,gross,order_count}], top_products:[{product_id,name,qty,revenue}], hourly_sales:[{hour,gross,order_count}], payment_methods:[{method,amount,count}], generated_at }`. C'est LE contrat que la Task 2 consomme.

- [ ] **Step 1 : Écrire la suite de test (échouera : fonction absente)**

Créer `supabase/tests/dashboard_overview.test.sql` :

```sql
-- supabase/tests/dashboard_overview.test.sql
-- S63 — get_dashboard_overview_v1 (dashboard d'accueil BO).
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
-- DB dev non vide -> assertions KPI en DELTA vs baseline capturé avant seed.
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_auth UUID; v_profile UUID; v_session UUID; v_cat UUID; v_prod UUID; v_cust UUID;
  v_o1 UUID; v_o2 UUID; v_o3 UUID; v_o4 UUID; v_o5 UUID;
  v_tz TEXT; v_today DATE; v_day2 DATE;
  v_before JSONB; v_after JSONB;
  v_cash_b NUMERIC; v_cash_a NUMERIC;
  v_type_b NUMERIC; v_type_a NUMERIC;
  v_hour_b NUMERIC; v_hour_a NUMERIC;
  v_d2_b NUMERIC; v_d2_a NUMERIC;
  v_rand UUID; v_denied BOOLEAN := false;
BEGIN
  -- Acteur : un user seedé qui a reports.read
  SELECT up.auth_user_id, up.id INTO v_auth, v_profile
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'reports.read')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_day2  := ((now() - interval '2 days') AT TIME ZONE v_tz)::date;

  -- ── Baseline avant seed ───────────────────────────────────────────────
  v_before := get_dashboard_overview_v1();
  v_cash_b := COALESCE((SELECT (e->>'amount')::numeric
                          FROM jsonb_array_elements(v_before->'payment_methods') e
                         WHERE e->>'method' = 'cash'), 0);
  v_type_b := COALESCE((SELECT (e->>'gross')::numeric
                          FROM jsonb_array_elements(v_before->'revenue_by_type') e
                         WHERE e->>'order_type' = 'take_out'), 0);
  v_hour_b := COALESCE((SELECT SUM((e->>'gross')::numeric)
                          FROM jsonb_array_elements(v_before->'hourly_sales') e), 0);
  v_d2_b   := COALESCE((SELECT (e->>'net')::numeric
                          FROM jsonb_array_elements(v_before->'revenue_30d') e
                         WHERE (e->>'date')::date = v_day2), 0);

  -- ── Seed ──────────────────────────────────────────────────────────────
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_profile, 0, 'closed') RETURNING id INTO v_session;
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, cost_price, unit, current_stock)
    VALUES ('TST-S63-DASH', 'S63 Dash Item', v_cat, 50000, 20000, 'pcs', 100)
    RETURNING id INTO v_prod;
  INSERT INTO customers (name, customer_type)
    VALUES ('S63 Dash Customer', 'retail') RETURNING id INTO v_cust;

  -- o1 : payée maintenant, 50 000, cash, client ; 1 ligne valide + 1 ligne ANNULÉE (exclue d'items_sold)
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, customer_id, paid_at)
    VALUES ('#S63O1', 'take_out', 'paid', 50000, 0, 50000, 'pos', v_session, v_cust, now())
    RETURNING id INTO v_o1;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o1, v_prod, 'S63 Dash Item', 50000, 1, 50000);
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, is_cancelled)
    VALUES (v_o1, v_prod, 'S63 Dash Item', 50000, 5, 250000, true);
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_o1, 'cash', 50000);

  -- o2 : payée AUJOURD'HUI 01:00 HEURE LOCALE (bord UTC : en Asia/Makassar c'est la veille 17:00 UTC), 30 000, qris
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, customer_id, paid_at)
    VALUES ('#S63O2', 'take_out', 'paid', 30000, 0, 30000, 'pos', v_session, v_cust,
            ((v_today + time '01:00') AT TIME ZONE v_tz))
    RETURNING id INTO v_o2;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    VALUES (v_o2, v_prod, 'S63 Dash Item', 30000, 1, 30000);
  INSERT INTO order_payments (order_id, method, amount) VALUES (v_o2, 'qris', 30000);

  -- o3 : VOIDED aujourd'hui, 99 000 -> exclue de tout
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, paid_at, voided_at)
    VALUES ('#S63O3', 'take_out', 'voided', 99000, 0, 99000, 'pos', v_session, now(), now())
    RETURNING id INTO v_o3;

  -- o4 : b2b_pending, 88 000, pas de paid_at -> exclue de tout
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#S63O4', 'b2b', 'b2b_pending', 88000, 0, 88000, 'pos')
    RETURNING id INTO v_o4;

  -- o5 : payée il y a 2 jours, 40 000 -> visible dans revenue_30d[day-2], pas dans les KPIs du jour
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via, session_id, paid_at)
    VALUES ('#S63O5', 'take_out', 'paid', 40000, 0, 40000, 'pos', v_session, now() - interval '2 days')
    RETURNING id INTO v_o5;

  -- refund : 10 000 sur o1 aujourd'hui -> revenue_today est NET
  INSERT INTO refunds (order_id, refund_number, reason, total, tax_refunded, refunded_by, authorized_by, session_id)
    VALUES (v_o1, 'RF-S63-1', 'S63 test refund', 10000, 0, v_profile, v_profile, v_session);

  -- ── Après seed ────────────────────────────────────────────────────────
  v_after := get_dashboard_overview_v1();
  v_cash_a := COALESCE((SELECT (e->>'amount')::numeric
                          FROM jsonb_array_elements(v_after->'payment_methods') e
                         WHERE e->>'method' = 'cash'), 0);
  v_type_a := COALESCE((SELECT (e->>'gross')::numeric
                          FROM jsonb_array_elements(v_after->'revenue_by_type') e
                         WHERE e->>'order_type' = 'take_out'), 0);
  v_hour_a := COALESCE((SELECT SUM((e->>'gross')::numeric)
                          FROM jsonb_array_elements(v_after->'hourly_sales') e), 0);
  v_d2_a   := COALESCE((SELECT (e->>'net')::numeric
                          FROM jsonb_array_elements(v_after->'revenue_30d') e
                         WHERE (e->>'date')::date = v_day2), 0);

  -- ── Assertions (delta) ────────────────────────────────────────────────
  -- T1 : net du jour = +50k +30k (o2 compte AUJOURD'HUI malgré le bord UTC) -10k refund ;
  --      o3 voided (99k) et o4 b2b_pending (88k) invisibles.
  INSERT INTO _r SELECT 'T01_revenue_today_net_delta_70k',
    (v_after->'kpis'->>'revenue_today')::numeric - (v_before->'kpis'->>'revenue_today')::numeric = 70000;
  INSERT INTO _r SELECT 'T02_orders_today_delta_2',
    (v_after->'kpis'->>'orders_today')::int - (v_before->'kpis'->>'orders_today')::int = 2;
  INSERT INTO _r SELECT 'T03_items_sold_delta_2_cancelled_excluded',
    (v_after->'kpis'->>'items_sold')::numeric - (v_before->'kpis'->>'items_sold')::numeric = 2;
  INSERT INTO _r SELECT 'T04_customers_today_delta_1',
    (v_after->'kpis'->>'customers_today')::int - (v_before->'kpis'->>'customers_today')::int = 1;
  -- T5 : avg_basket = recalcul indépendant brut/commandes sur la table orders
  INSERT INTO _r SELECT 'T05_avg_basket_matches_orders_table',
    (v_after->'kpis'->>'avg_basket')::numeric = (
      SELECT ROUND(SUM(o.total) / COUNT(*), 2) FROM orders o
       WHERE o.status IN ('paid','completed') AND o.voided_at IS NULL AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today);
  -- T6/T7 : série 30 j continue, bornée à aujourd'hui
  INSERT INTO _r SELECT 'T06_revenue_30d_has_30_points',
    jsonb_array_length(v_after->'revenue_30d') = 30;
  INSERT INTO _r SELECT 'T07_last_point_is_today',
    (v_after->'revenue_30d'->29->>'date')::date = v_today;
  INSERT INTO _r SELECT 'T08_day_minus_2_net_delta_40k', v_d2_a - v_d2_b = 40000;
  INSERT INTO _r SELECT 'T09_by_type_take_out_gross_delta_80k', v_type_a - v_type_b = 80000;
  INSERT INTO _r SELECT 'T10_top_products_contains_seeded',
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_after->'top_products') e
             WHERE (e->>'product_id')::uuid = v_prod
               AND e->>'name' = 'S63 Dash Item'
               AND (e->>'qty')::numeric >= 2);
  INSERT INTO _r SELECT 'T11_hourly_gross_delta_80k', v_hour_a - v_hour_b = 80000;
  INSERT INTO _r SELECT 'T12_payment_cash_delta_50k', v_cash_a - v_cash_b = 50000;

  -- T13 : sans reports.read -> 42501
  v_rand := gen_random_uuid();
  PERFORM set_config('request.jwt.claim.sub', v_rand::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rand)::text, true);
  BEGIN
    PERFORM get_dashboard_overview_v1();
    v_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  INSERT INTO _r SELECT 'T13_permission_denied_42501', v_denied;

  -- T14 : anon n'a pas EXECUTE (trio S20)
  INSERT INTO _r SELECT 'T14_anon_execute_revoked',
    NOT has_function_privilege('anon', 'public.get_dashboard_overview_v1()', 'EXECUTE');
END $$;

SELECT name, pass FROM _r ORDER BY name;
-- Attendu : 14 lignes, pass = true partout.
ROLLBACK;
```

- [ ] **Step 2 : Lancer la suite — vérifier l'échec attendu**

Via `mcp__plugin_supabase_supabase__execute_sql` (`project_id='ikcyvlovptebroadgtvd'`), coller le contenu ENTIER du fichier.
Attendu : **erreur `function get_dashboard_overview_v1() does not exist`** (SQLSTATE 42883). Tout autre échec = corriger le seed avant d'avancer.

- [ ] **Step 3 : Écrire la migration**

Créer `supabase/migrations/20260710000113_create_get_dashboard_overview_v1.sql` :

```sql
-- 20260710000113_create_get_dashboard_overview_v1.sql
-- S63 — Dashboard d'accueil BO : RPC agrégé unique (lecture pure).
-- Gate reports.read. Bucketing business_config.timezone (pattern _094).
-- Définition « commande valide » : miroir get_daily_sales_v1 (20260624000011) —
-- status IN ('paid','completed'), voided_at IS NULL, paid_at IS NOT NULL, jour local.
-- Le B2B ne compte qu'une fois payé (b2b_pending invisible). revenue_today est NET
-- (brut - refunds du jour) ; avg_basket = brut/commandes (miroir 'aov' Daily Sales).

CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz       TEXT;
  v_today    DATE;
  v_kpis     JSONB;
  v_rev30    JSONB;
  v_by_type  JSONB;
  v_top      JSONB;
  v_hourly   JSONB;
  v_payments JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- ── KPIs du jour ────────────────────────────────────────────────────────
  WITH valid_today AS (
    SELECT o.id, o.total, o.customer_id
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
  )
  SELECT jsonb_build_object(
    'revenue_today',
      COALESCE((SELECT SUM(total) FROM valid_today), 0)
      - COALESCE((SELECT SUM(r.total) FROM refunds r
                   WHERE ((r.created_at AT TIME ZONE v_tz))::date = v_today), 0),
    'orders_today',   (SELECT COUNT(*) FROM valid_today),
    'items_sold',
      COALESCE((SELECT SUM(oi.quantity) FROM order_items oi
                 JOIN valid_today vt ON vt.id = oi.order_id
                WHERE NOT oi.is_cancelled), 0),
    'avg_basket',
      CASE WHEN (SELECT COUNT(*) FROM valid_today) = 0 THEN 0
           ELSE ROUND(COALESCE((SELECT SUM(total) FROM valid_today), 0)
                      / (SELECT COUNT(*) FROM valid_today), 2) END,
    'customers_today',
      (SELECT COUNT(DISTINCT customer_id) FROM valid_today WHERE customer_id IS NOT NULL)
  ) INTO v_kpis;

  -- ── Tendance 30 j (série CONTINUE, jours vides à 0) ─────────────────────
  WITH days AS (
    SELECT d::date AS day
      FROM generate_series(v_today - 29, v_today, interval '1 day') d
  ),
  valid_orders AS (
    SELECT ((o.paid_at AT TIME ZONE v_tz))::date AS day, o.total
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_today - 29 AND v_today
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day, SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_today - 29 AND v_today
     GROUP BY 1
  ),
  agg AS (
    SELECT d.day,
           COALESCE(SUM(vo.total), 0)::NUMERIC(14,2) AS gross,
           COUNT(vo.total)::INT                      AS order_count
      FROM days d
      LEFT JOIN valid_orders vo ON vo.day = d.day
     GROUP BY d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date',        a.day,
           'net',         a.gross - COALESCE(dr.refund_total, 0),
           'order_count', a.order_count
         ) ORDER BY a.day), '[]'::jsonb)
    INTO v_rev30
    FROM agg a
    LEFT JOIN day_refunds dr ON dr.day = a.day;

  -- ── Revenu par type de commande (aujourd'hui) ───────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_type', t.order_type, 'gross', t.gross, 'order_count', t.cnt
         ) ORDER BY t.gross DESC), '[]'::jsonb)
    INTO v_by_type
    FROM (
      SELECT o.order_type::text AS order_type,
             SUM(o.total)::NUMERIC(14,2) AS gross,
             COUNT(*)::INT AS cnt
        FROM orders o
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
       GROUP BY o.order_type
    ) t;

  -- ── Top 5 produits du jour (par revenu, lignes annulées exclues) ────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', p.product_id, 'name', p.name,
           'qty', p.qty, 'revenue', p.revenue
         ) ORDER BY p.revenue DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT oi.product_id,
             MAX(oi.name_snapshot)              AS name,
             SUM(oi.quantity)::NUMERIC          AS qty,
             SUM(oi.line_total)::NUMERIC(14,2)  AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
         AND NOT oi.is_cancelled
       GROUP BY oi.product_id
       ORDER BY revenue DESC
       LIMIT 5
    ) p;

  -- ── Ventes par heure locale (aujourd'hui ; heures sans vente omises) ────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'hour', h.hour, 'gross', h.gross, 'order_count', h.cnt
         ) ORDER BY h.hour), '[]'::jsonb)
    INTO v_hourly
    FROM (
      SELECT EXTRACT(HOUR FROM (o.paid_at AT TIME ZONE v_tz))::INT AS hour,
             SUM(o.total)::NUMERIC(14,2) AS gross,
             COUNT(*)::INT AS cnt
        FROM orders o
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
       GROUP BY 1
    ) h;

  -- ── Moyens de paiement du jour (rattachés aux commandes valides) ────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'method', pm.method, 'amount', pm.amount, 'count', pm.cnt
         ) ORDER BY pm.amount DESC), '[]'::jsonb)
    INTO v_payments
    FROM (
      SELECT op.method::text AS method,
             SUM(op.amount)::NUMERIC(14,2) AS amount,
             COUNT(*)::INT AS cnt
        FROM order_payments op
        JOIN orders o ON o.id = op.order_id
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND ((op.paid_at AT TIME ZONE v_tz))::date = v_today
       GROUP BY op.method
    ) pm;

  RETURN jsonb_build_object(
    'kpis',            v_kpis,
    'revenue_30d',     v_rev30,
    'revenue_by_type', v_by_type,
    'top_products',    v_top,
    'hourly_sales',    v_hourly,
    'payment_methods', v_payments,
    'generated_at',    now()
  );
END;
$$;

COMMENT ON FUNCTION public.get_dashboard_overview_v1() IS
  'S63 — BO home dashboard aggregate (today KPIs net-of-refunds, 30d trend, by-type, top products, hourly, payment methods). Read-only. Gate reports.read.';

REVOKE ALL ON FUNCTION public.get_dashboard_overview_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_overview_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v1() TO authenticated;
```

- [ ] **Step 4 : Appliquer la migration via MCP**

`mcp__plugin_supabase_supabase__apply_migration` avec `project_id='ikcyvlovptebroadgtvd'`, `name='create_get_dashboard_overview_v1'`, `query=<contenu du fichier>`.
Attendu : succès sans erreur.

- [ ] **Step 5 : Relancer la suite — vérifier le vert**

Re-coller `supabase/tests/dashboard_overview.test.sql` entier dans `execute_sql`.
Attendu : **14 lignes, `pass = true` partout**. Si T01/T09/T11 échouent d'un montant fixe, suspecter le bord timezone d'o2 (vérifier `business_config.timezone` live) avant de toucher au RPC.

- [ ] **Step 6 : Regen types + typecheck**

`mcp__plugin_supabase_supabase__generate_typescript_types` (`project_id='ikcyvlovptebroadgtvd'`) → écrire le champ `types` dans `packages/supabase/src/types.generated.ts`.
Run : `pnpm typecheck` — Attendu : exit 0 (aucun consommateur encore).
Vérifier que le diff contient `get_dashboard_overview_v1` dans `Functions`.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260710000113_create_get_dashboard_overview_v1.sql supabase/tests/dashboard_overview.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): get_dashboard_overview_v1 — RPC agrégé dashboard BO (gate reports.read, tz-aware, net of refunds)

pgTAP dashboard_overview 14/14 live. Migration 20260710000113.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : Hook `useDashboardOverview` + câblage KPIs + état « accès restreint »

**Files:**
- Create: `apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts`
- Modify: `apps/backoffice/src/pages/Dashboard.tsx` (réécriture complète fournie)
- Test: `apps/backoffice/src/pages/__tests__/Dashboard.test.tsx` (réécriture complète fournie)

**Interfaces:**
- Consumes: `supabase.rpc('get_dashboard_overview_v1')` (Task 1).
- Produces: `useDashboardOverview(enabled?: boolean)` → `UseQueryResult<DashboardOverview, Error>` ; types exportés `DashboardOverview`, `DashboardKpis`, `RevenueDay`, `RevenueByType`, `TopProduct`, `HourlySale`, `PaymentMethodLine` ; `classifyDashboardError(e: unknown): 'permission_denied' | 'unknown'`. `Dashboard.tsx` exporte toujours `DashboardPageProps { data?: DashboardData }` avec `DashboardData = { data: DashboardOverview | null; isLoading: boolean; error: Error | null; refetch: () => void }` (nouvelle forme — les panneaux Task 3 consomment `overview.revenue_30d` etc.).

- [ ] **Step 1 : Écrire le hook**

Créer `apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts` :

```ts
// apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts
// S63 — hook du dashboard d'accueil : un seul RPC agrégé, pollé à 60 s.
// L'enveloppe jsonb du RPC est typée à la main (le regen produit `Json`),
// même pattern que usePaymentsByMethod.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DashboardKpis {
  revenue_today:   number;
  orders_today:    number;
  items_sold:      number;
  avg_basket:      number;
  customers_today: number;
}
export interface RevenueDay        { date: string; net: number; order_count: number }
export interface RevenueByType     { order_type: string; gross: number; order_count: number }
export interface TopProduct        { product_id: string; name: string; qty: number; revenue: number }
export interface HourlySale        { hour: number; gross: number; order_count: number }
export interface PaymentMethodLine { method: string; amount: number; count: number }

export interface DashboardOverview {
  kpis:            DashboardKpis;
  revenue_30d:     RevenueDay[];
  revenue_by_type: RevenueByType[];
  top_products:    TopProduct[];
  hourly_sales:    HourlySale[];
  payment_methods: PaymentMethodLine[];
  generated_at:    string;
}

export type DashboardErrorKind = 'permission_denied' | 'unknown';

export function classifyDashboardError(e: unknown): DashboardErrorKind {
  const code = (e as { code?: string } | null)?.code;
  const msg  = e instanceof Error ? e.message : String(e);
  if (code === '42501' || /permission denied/i.test(msg)) return 'permission_denied';
  return 'unknown';
}

export function useDashboardOverview(enabled = true) {
  return useQuery<DashboardOverview, Error>({
    queryKey: ['dashboard-overview'],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_dashboard_overview_v1');
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as DashboardOverview;
    },
    refetchInterval: 60_000,
    staleTime:       30_000,
    enabled,
  });
}
```

- [ ] **Step 2 : Réécrire les tests smoke (échoueront : nouvelle forme d'enveloppe)**

Remplacer intégralement `apps/backoffice/src/pages/__tests__/Dashboard.test.tsx` :

```tsx
// apps/backoffice/src/pages/__tests__/Dashboard.test.tsx
//
// S63 — Dashboard smoke tests (enveloppe get_dashboard_overview_v1).
// La prop `data` désactive le hook (enabled=false) : aucun réseau en test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DashboardPage from '@/pages/Dashboard.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { DashboardOverview } from '@/features/dashboard/hooks/useDashboardOverview.js';

beforeEach(() => {
  cleanup();
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Mamat', role_code: 'OWNER', employee_code: 'E1' },
    sessionToken: 'tok',
    permissions: [],
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function overviewFixture(): DashboardOverview {
  return {
    kpis: {
      revenue_today: 1_500_000,
      orders_today: 12,
      items_sold: 30,
      avg_basket: 125_000,
      customers_today: 8,
    },
    revenue_30d: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      net: i * 10_000,
      order_count: i,
    })),
    revenue_by_type: [
      { order_type: 'take_out', gross: 900_000, order_count: 8 },
      { order_type: 'dine_in', gross: 600_000, order_count: 4 },
    ],
    top_products: [
      { product_id: 'p-1', name: 'Croissant', qty: 10, revenue: 350_000 },
    ],
    hourly_sales: [{ hour: 8, gross: 500_000, order_count: 5 }],
    payment_methods: [
      { method: 'cash', amount: 1_000_000, count: 8 },
      { method: 'qris', amount: 500_000, count: 4 },
    ],
    generated_at: '2026-07-06T12:00:00Z',
  };
}

describe('DashboardPage', () => {
  it('renders the title and all 5 KPI tile labels with data', () => {
    wrap(
      <DashboardPage
        data={{ data: overviewFixture(), isLoading: false, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/Today's revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/^Orders$/i)).toBeInTheDocument();
    expect(screen.getByText(/Items sold/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg basket/i)).toBeInTheDocument();
    expect(screen.getByText(/^Customers$/i)).toBeInTheDocument();
  });

  it('renders the greeting with the user full name', () => {
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: false, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Mamat/i)).toBeInTheDocument();
  });

  it('renders 5 skeleton tiles when the data hook is loading', () => {
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: true, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(5);
  });

  it('renders the error banner on a generic error', () => {
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: false, error: new Error('rpc_failed'), refetch: vi.fn() }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/rpc_failed/);
  });

  it('renders the restricted state (no KPI row, no alert) on permission denied', () => {
    const err = Object.assign(new Error('permission denied: reports.read required'), {
      code: '42501',
    });
    wrap(
      <DashboardPage
        data={{ data: null, isLoading: false, error: err, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByTestId('dashboard-restricted')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-kpi-row')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('calls refetch when the refresh icon is clicked', () => {
    const refetch = vi.fn();
    wrap(
      <DashboardPage
        data={{ data: overviewFixture(), isLoading: false, error: null, refetch }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh dashboard/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3 : Lancer les tests — vérifier l'échec**

Run : `pnpm --filter @breakery/backoffice test Dashboard`
Attendu : FAIL (l'ancienne page attend l'enveloppe plate `revenue_today` au premier niveau ; l'état restreint n'existe pas).

- [ ] **Step 4 : Réécrire `Dashboard.tsx` (KPIs + restreint ; panneaux encore en EmptyState)**

Remplacer intégralement `apps/backoffice/src/pages/Dashboard.tsx` :

```tsx
// apps/backoffice/src/pages/Dashboard.tsx
//
// S63 — Backoffice Dashboard, câblé sur get_dashboard_overview_v1.
//
// Layout (matches docs/Design/backoffice/Dashboard.jpg):
//   - Header: "Dashboard" serif title + greeting line
//   - 5 KPI tiles: TODAY'S REVENUE (net of refunds), ORDERS, ITEMS SOLD,
//     AVG BASKET, CUSTOMERS
//   - 30-DAY REVENUE TREND + REVENUE BY ORDER TYPE
//   - TOP PRODUCTS TODAY + HOURLY SALES + PAYMENT METHODS
//
// Data: useDashboardOverview (React Query, 60 s polling). The optional
// `data` prop overrides the hook for tests (hook disabled, no network).
// A 42501 from the RPC renders the restricted state instead of an error.

import { useMemo } from 'react';
import {
  DollarSign, ShoppingBag, Box, TrendingUp, Users as UsersIcon,
  RefreshCw, Lock,
} from 'lucide-react';
import {
  Card, KpiTile, SectionLabel, EmptyState, cn,
} from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useDashboardOverview,
  classifyDashboardError,
  type DashboardOverview,
} from '@/features/dashboard/hooks/useDashboardOverview.js';

export interface DashboardData {
  data: DashboardOverview | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export interface DashboardPageProps {
  /** Test-only override — when provided, the live hook is disabled. */
  data?: DashboardData;
}

const ZERO_KPIS = {
  revenue_today: 0,
  orders_today: 0,
  items_sold: 0,
  avg_basket: 0,
  customers_today: 0,
} as const;

function formatGreeting(name: string | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const who = name ?? 'there';
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  return `Good ${part}, ${who}. ${date}.`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '--:--';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

export default function DashboardPage({ data }: DashboardPageProps) {
  const user = useAuthStore((s) => s.user);
  const live = useDashboardOverview(data === undefined);

  const overview  = data !== undefined ? data.data : live.data ?? null;
  const isLoading = data !== undefined ? data.isLoading : live.isLoading;
  const error     = data !== undefined ? data.error : live.error ?? null;
  const refetch   = data !== undefined ? data.refetch : () => { void live.refetch(); };

  const restricted =
    error !== null && classifyDashboardError(error) === 'permission_denied';
  const kpis = overview?.kpis ?? ZERO_KPIS;

  const greeting = useMemo(() => formatGreeting(user?.full_name), [user?.full_name]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-text-primary">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-1">{greeting}</p>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-overlay text-xs text-text-secondary"
          aria-live="polite"
        >
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
          <span>Last updated {formatTime(overview?.generated_at)}</span>
          <button
            type="button"
            onClick={refetch}
            className="ml-1 text-text-secondary hover:text-text-primary"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} aria-hidden />
          </button>
        </div>
      </div>

      {restricted ? (
        <Card variant="default" padding="md" data-testid="dashboard-restricted">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 text-text-muted" aria-hidden />
            <div>
              <p className="text-sm text-text-primary">Dashboard metrics are restricted.</p>
              <p className="text-xs text-text-muted mt-0.5">
                Viewing business metrics requires the reports permission. Contact an administrator.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {error !== null && (
            <Card variant="default" padding="md" role="alert">
              <p className="text-sm text-danger">
                Failed to load dashboard: {error.message}
              </p>
            </Card>
          )}

          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4"
            data-testid="dashboard-kpi-row"
          >
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Card
                  key={i}
                  variant="default"
                  padding="md"
                  data-testid="kpi-skeleton"
                  className="h-32 animate-pulse"
                >
                  <div className="h-9 w-9 rounded-md bg-bg-overlay mb-3" />
                  <div className="h-3 w-20 bg-bg-overlay rounded mb-2" />
                  <div className="h-7 w-24 bg-bg-overlay rounded" />
                </Card>
              ))
            ) : (
              <>
                <KpiTile
                  icon={DollarSign}
                  label="Today's revenue"
                  value={kpis.revenue_today}
                  valueFormat="currency"
                />
                <KpiTile
                  icon={ShoppingBag}
                  label="Orders"
                  value={kpis.orders_today}
                  valueFormat="number"
                />
                <KpiTile
                  icon={Box}
                  label="Items sold"
                  value={kpis.items_sold}
                  valueFormat="number"
                />
                <KpiTile
                  icon={TrendingUp}
                  label="Avg basket"
                  value={kpis.avg_basket}
                  valueFormat="currency"
                />
                <KpiTile
                  icon={UsersIcon}
                  label="Customers"
                  value={kpis.customers_today}
                  valueFormat="number"
                />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card variant="default" padding="md" className="min-h-[280px]">
              <SectionLabel as="h2" size="xs" className="mb-2">
                30-day revenue trend
              </SectionLabel>
              <p className="text-xs text-text-muted mb-4">Daily revenue over the last 30 days</p>
              <div className="h-48 flex items-center justify-center">
                <EmptyState
                  size="sm"
                  title="No revenue data"
                  description="Trend chart appears once orders are recorded."
                />
              </div>
            </Card>
            <Card variant="default" padding="md" className="min-h-[280px]">
              <SectionLabel as="h2" size="xs" className="mb-2">
                Revenue by order type
              </SectionLabel>
              <div className="h-56 flex items-center justify-center">
                <EmptyState size="sm" title="No data available" />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card variant="default" padding="md" className="min-h-[220px]">
              <SectionLabel as="h2" size="xs" className="mb-3">
                Top products today
              </SectionLabel>
              <div className="h-40 flex items-center justify-center">
                <EmptyState size="sm" title="No sales today yet" />
              </div>
            </Card>
            <Card variant="default" padding="md" className="min-h-[220px]">
              <SectionLabel as="h2" size="xs" className="mb-3">
                Hourly sales
              </SectionLabel>
              <div className="h-40 flex items-center justify-center">
                <EmptyState size="sm" title="No sales data yet" />
              </div>
            </Card>
            <Card variant="default" padding="md" className="min-h-[220px]">
              <SectionLabel as="h2" size="xs" className="mb-3">
                Payment methods
              </SectionLabel>
              <div className="h-40 flex items-center justify-center">
                <EmptyState size="sm" title="No payments yet" />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5 : Lancer les tests — vérifier le vert**

Run : `pnpm --filter @breakery/backoffice test Dashboard`
Attendu : PASS (6 tests). Puis `pnpm typecheck` → exit 0.

- [ ] **Step 6 : Commit**

```bash
git add apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts apps/backoffice/src/pages/Dashboard.tsx apps/backoffice/src/pages/__tests__/Dashboard.test.tsx
git commit -m "feat(backoffice): câble le Dashboard sur get_dashboard_overview_v1 — KPIs réels, polling 60s, état accès restreint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Les 5 panneaux (recharts + listes)

**Files:**
- Create: `apps/backoffice/src/features/dashboard/components/RevenueTrendChart.tsx`
- Create: `apps/backoffice/src/features/dashboard/components/RevenueByTypeDonut.tsx`
- Create: `apps/backoffice/src/features/dashboard/components/HourlySalesChart.tsx`
- Create: `apps/backoffice/src/features/dashboard/components/TopProductsList.tsx`
- Create: `apps/backoffice/src/features/dashboard/components/PaymentMethodsList.tsx`
- Modify: `apps/backoffice/src/pages/Dashboard.tsx` (remplacement des 5 EmptyState par les composants)
- Test: `apps/backoffice/src/pages/__tests__/Dashboard.test.tsx` (2 tests ajoutés)

**Interfaces:**
- Consumes: types `RevenueDay`, `RevenueByType`, `HourlySale`, `TopProduct`, `PaymentMethodLine` du hook (Task 2) ; `chartColors.ts` existant (`COGS_BASE`, `familyColor`, `CHART_GRID_STROKE`, `CHART_AXIS_TICK`, `CHART_TOOLTIP_STYLE`, `formatIdrFull`, `formatIdrCompact`).
- Produces: 5 composants nommés, chacun `({ data }) => JSX` avec EmptyState interne quand la série est vide.

- [ ] **Step 1 : Ajouter les 2 tests de panneaux (échoueront)**

Dans `Dashboard.test.tsx`, ajouter à la fin du `describe` :

```tsx
  it('renders panel content (top product name, payment method) from data', () => {
    wrap(
      <DashboardPage
        data={{ data: overviewFixture(), isLoading: false, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByText(/Croissant/i)).toBeInTheDocument();
    expect(screen.getByText(/^cash$/i)).toBeInTheDocument();
  });

  it('renders panel empty states when today has no activity', () => {
    const empty: DashboardOverview = {
      ...overviewFixture(),
      revenue_30d: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-06-${String(i + 1).padStart(2, '0')}`, net: 0, order_count: 0,
      })),
      revenue_by_type: [],
      top_products: [],
      hourly_sales: [],
      payment_methods: [],
    };
    wrap(
      <DashboardPage
        data={{ data: empty, isLoading: false, error: null, refetch: vi.fn() }}
      />,
    );
    expect(screen.getByText(/No revenue data/i)).toBeInTheDocument();
    expect(screen.getByText(/No sales today yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No payments yet/i)).toBeInTheDocument();
  });
```

Run : `pnpm --filter @breakery/backoffice test Dashboard` — Attendu : FAIL (le premier nouveau test : « Croissant » absent, la page affiche encore les EmptyState statiques).

- [ ] **Step 2 : Créer `RevenueTrendChart.tsx`**

```tsx
// apps/backoffice/src/features/dashboard/components/RevenueTrendChart.tsx
// S63 — tendance 30 j (net/jour). Série continue fournie par le RPC.

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  COGS_BASE, CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import type { RevenueDay } from '../hooks/useDashboardOverview.js';

export function RevenueTrendChart({ data }: { data: RevenueDay[] }) {
  const hasData = data.some((d) => d.net !== 0 || d.order_count !== 0);
  if (!hasData) {
    return (
      <div className="h-48 flex items-center justify-center">
        <EmptyState
          size="sm"
          title="No revenue data"
          description="Trend chart appears once orders are recorded."
        />
      </div>
    );
  }
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: CHART_AXIS_TICK }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={6}
          />
          <YAxis
            tick={{ fontSize: 10, fill: CHART_AXIS_TICK }}
            tickFormatter={formatIdrCompact}
            width={72}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number) => [formatIdrFull(v), 'Net revenue']}
          />
          <Line type="monotone" dataKey="net" stroke={COGS_BASE} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3 : Créer `RevenueByTypeDonut.tsx`**

```tsx
// apps/backoffice/src/features/dashboard/components/RevenueByTypeDonut.tsx
// S63 — revenu du jour par type de commande (donut).

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  familyColor, CHART_TOOLTIP_STYLE, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import type { RevenueByType } from '../hooks/useDashboardOverview.js';

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  take_out: 'Take-out',
  delivery: 'Delivery',
  b2b: 'B2B',
};

export function RevenueByTypeDonut({ data }: { data: RevenueByType[] }) {
  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center">
        <EmptyState size="sm" title="No data available" />
      </div>
    );
  }
  const rows = data.map((d) => ({
    ...d,
    label: TYPE_LABELS[d.order_type] ?? d.order_type,
  }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={rows}
            dataKey="gross"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {rows.map((row, i) => (
              <Cell key={row.order_type} fill={familyColor('cogs', i)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number) => formatIdrFull(v)}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4 : Créer `HourlySalesChart.tsx`**

```tsx
// apps/backoffice/src/features/dashboard/components/HourlySalesChart.tsx
// S63 — ventes du jour par heure locale. Le RPC omet les heures sans vente ;
// l'axe 0-23 est complété à 0 ici (décision spec §4.3).

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { EmptyState } from '@breakery/ui';
import {
  COGS_BASE, CHART_GRID_STROKE, CHART_AXIS_TICK, CHART_TOOLTIP_STYLE,
  formatIdrCompact, formatIdrFull,
} from '@/features/reports/utils/chartColors.js';
import type { HourlySale } from '../hooks/useDashboardOverview.js';

export function HourlySalesChart({ data }: { data: HourlySale[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center">
        <EmptyState size="sm" title="No sales data yet" />
      </div>
    );
  }
  const filled = Array.from({ length: 24 }, (_, h) => {
    const found = data.find((d) => d.hour === h);
    return { hour: h, gross: found?.gross ?? 0, order_count: found?.order_count ?? 0 };
  });
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={filled} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fontSize: 9, fill: CHART_AXIS_TICK }}
            interval={3}
          />
          <YAxis
            tick={{ fontSize: 9, fill: CHART_AXIS_TICK }}
            tickFormatter={formatIdrCompact}
            width={64}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number) => [formatIdrFull(v), 'Sales']}
            labelFormatter={(h: number) => `${String(h).padStart(2, '0')}:00`}
          />
          <Bar dataKey="gross" fill={COGS_BASE} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5 : Créer `TopProductsList.tsx` et `PaymentMethodsList.tsx`**

```tsx
// apps/backoffice/src/features/dashboard/components/TopProductsList.tsx
// S63 — top 5 produits du jour par revenu (liste, plus lisible qu'un graphe).

import { EmptyState } from '@breakery/ui';
import { formatIdrFull } from '@/features/reports/utils/chartColors.js';
import type { TopProduct } from '../hooks/useDashboardOverview.js';

export function TopProductsList({ data }: { data: TopProduct[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center">
        <EmptyState size="sm" title="No sales today yet" />
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {data.map((p, i) => (
        <li key={p.product_id} className="flex items-center gap-3 text-sm">
          <span className="w-5 text-text-muted tabular-nums">{i + 1}.</span>
          <span className="flex-1 truncate text-text-primary">{p.name}</span>
          <span className="text-text-muted tabular-nums">×{p.qty}</span>
          <span className="text-text-primary tabular-nums">{formatIdrFull(p.revenue)}</span>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// apps/backoffice/src/features/dashboard/components/PaymentMethodsList.tsx
// S63 — encaissements du jour par moyen de paiement (montant + part %).

import { EmptyState } from '@breakery/ui';
import { formatIdrFull } from '@/features/reports/utils/chartColors.js';
import type { PaymentMethodLine } from '../hooks/useDashboardOverview.js';

export function PaymentMethodsList({ data }: { data: PaymentMethodLine[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center">
        <EmptyState size="sm" title="No payments yet" />
      </div>
    );
  }
  const total = data.reduce((s, m) => s + m.amount, 0);
  return (
    <ul className="space-y-2">
      {data.map((m) => (
        <li key={m.method} className="flex items-center gap-3 text-sm">
          <span className="flex-1 truncate text-text-primary">{m.method}</span>
          <span className="text-text-muted tabular-nums">
            {total > 0 ? Math.round((m.amount / total) * 100) : 0}%
          </span>
          <span className="text-text-primary tabular-nums">{formatIdrFull(m.amount)}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6 : Brancher les panneaux dans `Dashboard.tsx`**

Ajouter les imports sous ceux du hook :

```tsx
import { RevenueTrendChart } from '@/features/dashboard/components/RevenueTrendChart.js';
import { RevenueByTypeDonut } from '@/features/dashboard/components/RevenueByTypeDonut.js';
import { HourlySalesChart } from '@/features/dashboard/components/HourlySalesChart.js';
import { TopProductsList } from '@/features/dashboard/components/TopProductsList.js';
import { PaymentMethodsList } from '@/features/dashboard/components/PaymentMethodsList.js';
```

Puis remplacer les 5 blocs `<div className="h-48 flex items-center justify-center">…EmptyState…</div>` (et h-56/h-40) par, respectivement :

```tsx
<RevenueTrendChart data={overview?.revenue_30d ?? []} />
<RevenueByTypeDonut data={overview?.revenue_by_type ?? []} />
<TopProductsList data={overview?.top_products ?? []} />
<HourlySalesChart data={overview?.hourly_sales ?? []} />
<PaymentMethodsList data={overview?.payment_methods ?? []} />
```

(l'ordre des cartes dans la page reste : trend, by-type, puis top products / hourly / payments).

- [ ] **Step 7 : Lancer les tests — vérifier le vert**

Run : `pnpm --filter @breakery/backoffice test Dashboard`
Attendu : PASS (8 tests). Puis `pnpm typecheck` → exit 0.
Note recharts/jsdom : `ResponsiveContainer` rend un conteneur vide en jsdom (largeur 0) — les assertions des tests portent volontairement sur les LISTES (top products, payments) et les EmptyState, jamais sur le SVG des charts.

- [ ] **Step 8 : Commit**

```bash
git add apps/backoffice/src/features/dashboard/components/ apps/backoffice/src/pages/Dashboard.tsx apps/backoffice/src/pages/__tests__/Dashboard.test.tsx
git commit -m "feat(backoffice): les 5 panneaux du Dashboard — trend 30j, donut par type, barres horaires, top produits, paiements

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Closeout S63

**Files:**
- Create: `docs/workplan/plans/2026-07-06-session-63-INDEX.md`
- Modify: `docs/workplan/remise-a-plat/14-reports-analytics.md` (note de tête + D2.1 ✅)
- Modify: `CLAUDE.md` (Active Workplan : S63 merged)

**Interfaces:**
- Consumes: l'ensemble des livrables Tasks 1-3.
- Produces: branche mergée + doc de session.

- [ ] **Step 1 : Vérification complète**

Run : `pnpm typecheck && pnpm build && pnpm test`
Attendu : exit 0 partout (baseline env-gated pré-existante tolérée — ne pas confondre avec une régression).
Re-passer la suite `dashboard_overview.test.sql` via MCP `execute_sql` : 14/14 `pass=true`.

- [ ] **Step 2 : Écrire l'INDEX de session**

Créer `docs/workplan/plans/2026-07-06-session-63-INDEX.md` :

```markdown
# Session 63 — INDEX (2026-07-06)

**Chantier :** Vague 2 — Dashboard BO réel (fiche 14 D2.1).
**Branche :** `swarm/session-63`. **Spec :** `docs/superpowers/specs/2026-07-06-s63-dashboard-overview-design.md`. **Plan :** `docs/superpowers/plans/2026-07-06-s63-dashboard-overview.md`.

## Livré
- RPC `get_dashboard_overview_v1` (migration `20260710000113`) — lecture pure, gate `reports.read`, trio S20, bucketing `business_config.timezone`, miroir « commande valide » de `get_daily_sales_v1` ; B2B compté au paiement ; `revenue_today` net des refunds ; série 30 j continue.
- Hook `useDashboardOverview` (polling 60 s) + `Dashboard.tsx` câblé (KPIs réels, état « accès restreint » sur 42501, Last updated serveur).
- 5 panneaux : LineChart 30 j, donut par type, BarChart horaire (0-23 complété client), listes top produits / moyens de paiement — recharts + `chartColors.ts` existants.
- Tests : pgTAP `dashboard_overview` 14/14 live ; smoke `Dashboard.test.tsx` 8/8 ; typecheck/build/test monorepo verts.
- Money-path non touchée (RPC lecture pure, aucun RPC de vente modifié).

## Déviations
(compléter au fil de l'exécution — numérotées DEV-S63-NN)

## Dettes
(compléter au closeout — D-1..D-N)
```

- [ ] **Step 3 : Mettre à jour la fiche 14**

Dans `docs/workplan/remise-a-plat/14-reports-analytics.md` :
- Ajouter sous la ligne de titre : `> **MAJ S63 (2026-07-06)** : Dashboard d'accueil câblé — \`get_dashboard_overview_v1\` (\`_113\`) + \`useDashboardOverview\` + 5 panneaux réels. Le constat « stub à zéros » (§C, fin) et D2.1 sont soldés.`
- Dans §D2, passer la ligne 1 à : `1. ✅ **Câbler le Dashboard d'accueil — SOLDÉ (S63, 2026-07-06)** : ...` (conserver le texte original à la suite).

- [ ] **Step 4 : Bump CLAUDE.md (Active Workplan)**

Dans la section Active Workplan : passer « In flight » à `rien` avec S63 livré ; insérer en tête de « Merged (latest) » un bloc S63 (RPC `_113` lecture pure gate `reports.read`, hook polling 60 s, 5 panneaux, pgTAP 14/14, money-path intouchée, INDEX `docs/workplan/plans/2026-07-06-session-63-INDEX.md`) ; rétrograder S62 en « Previously merged ». Ajuster « Prochaine session (S64) » : chantiers Vague 2 restants et/ou spec « mise en prod ».

- [ ] **Step 5 : Commit docs + PR**

```bash
git add docs/workplan/plans/2026-07-06-session-63-INDEX.md docs/workplan/remise-a-plat/14-reports-analytics.md CLAUDE.md
git commit -m "docs(workplan): closeout S63 — Dashboard BO réel livré

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin swarm/session-63
gh pr create --title "S63 — Dashboard BO réel (get_dashboard_overview_v1 + 5 panneaux)" --body "$(cat <<'EOF'
## Summary
- RPC get_dashboard_overview_v1 (migration 20260710000113) : lecture pure, gate reports.read, trio S20, tz-aware, net of refunds, série 30 j continue
- Dashboard.tsx câblé : KPIs réels, polling 60 s, état accès restreint (42501)
- 5 panneaux recharts/listes (trend, donut par type, barres horaires, top produits, paiements)

## Test plan
- pgTAP dashboard_overview 14/14 live (delta-based, DB non vide)
- Smoke Dashboard.test.tsx 8/8 ; pnpm typecheck/build/test verts

Spec : docs/superpowers/specs/2026-07-06-s63-dashboard-overview-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Attendu : PR ouverte ; revue pattern-guardian avant merge (squash) selon la convention de session.

---

## Self-Review (fait à la rédaction)

1. **Couverture spec :** §3 contrat serveur → Task 1 ; §4.1 hook → Task 2 ; §4.2 câblage + restreint → Task 2 ; §4.3 panneaux (+ remplissage 0-23 client) → Task 3 ; §5 tests (pgTAP 14 assertions couvrant seed/exclusions/30 points/timezone/42501/ACL anon ; smoke 8 tests ; regen types Task 1 Step 6 ; chaîne standard Task 4) ; §6 points DB live → tous résolus et documentés dans « Faits vérifiés » ; §7 fiche 14 + CLAUDE.md → Task 4. Aucun écart.
2. **Placeholders :** aucun TBD/TODO ; tout code montré en entier (migration, suite SQL, hook, page, 5 composants, tests).
3. **Cohérence de types :** l'enveloppe SQL (`kpis.revenue_today`…) = interface `DashboardOverview` du hook = fixture des tests = props des panneaux (`RevenueDay`/`RevenueByType`/`HourlySale`/`TopProduct`/`PaymentMethodLine`) — noms identiques partout ; `classifyDashboardError` consommé par la page ; `data === undefined` (et non falsy) pour désactiver le hook.
