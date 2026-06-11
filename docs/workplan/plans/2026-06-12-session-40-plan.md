# Session 40 — Plan : Reports close-out — les 9 cards « Soon » du hub

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Activer les 9 dernières cards « Soon » du hub Reports (Daily Sales, Purchase Items/by Date/by Supplier, Staff Performance, Production Report/Efficiency, Price Changes, Permission Change Log) — 9 RPCs + 1 trigger d'audit RBAC + 9 pages BO CSV-only — hub 100 % actif.

**Architecture :** Pattern S30 canonique : RPC `SECURITY DEFINER` JSONB + REVOKE pair S25 par report ; hooks `useQuery` + pages `ReportPage` + `ExportButtons` CSV-only ; wiring (routes/sidebar/hub) centralisé en Wave C pour permettre la parallélisation de la Wave B. **Zéro nouvelle table, zéro nouvelle permission, EF intouchée.**

**Tech stack :** Supabase cloud V3 dev `ikcyvlovptebroadgtvd` (MCP apply_migration/execute_sql/generate_typescript_types), pgTAP, React 18 + TanStack Query + `@breakery/ui`, Vitest smokes, Playwright E2E.

**Spec :** [`docs/workplan/specs/2026-06-12-session-40-spec.md`](../specs/2026-06-12-session-40-spec.md)
**Branche :** `swarm/session-40` (base `master` @ `e3ec866`)
**Bloc migrations :** `20260624000010..019` (vérifier base via `list_migrations` — prior max NAME attendu `20260623000012`)

---

## Conventions communes (toutes waves)

- **RPC template** : lire `supabase/migrations/20260524231049_create_get_payments_by_method_v1_rpc.sql` (S30) avant d'écrire le premier RPC — reprendre exactement : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `STABLE`, gate `has_permission(auth.uid(), '<perm>')` → `RAISE ... USING ERRCODE = '42501'`, garde auth-first (`auth.uid() IS NULL` → 42501), parsing dates `TEXT 'YYYY-MM-DD'` avec clamp/validation, bucketing timezone via `business_config.timezone` (défaut `Asia/Makassar`), retour `jsonb_build_object`, `COMMENT ON FUNCTION`.
- **REVOKE pair S25** (dans la même migration que le RPC) :
  ```sql
  REVOKE ALL ON FUNCTION public.<fn>(<args>) FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM anon;
  GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;
  ```
- **Apply** : `mcp__plugin_supabase_supabase__apply_migration` (project_id `ikcyvlovptebroadgtvd`) + fichier identique committé sous `supabase/migrations/`. JAMAIS de Docker/db reset.
- **pgTAP** : fichier cumulatif `supabase/tests/s40_reports.test.sql`, exécuté via `execute_sql` enveloppé `BEGIN; ... ROLLBACK;`. Seed des données de test DANS la transaction.
- **Commits** : `feat(db|backoffice): session 40 — <task> — <topic>` + co-author Claude.
- **Wave B — interdiction stricte** : ne PAS toucher `apps/backoffice/src/routes/index.tsx`, `apps/backoffice/src/layouts/Sidebar.tsx`, `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` (réservés Wave C, 3 agents B en parallèle sinon conflits).

---

## Wave A — DB (agent `db-engineer`, séquentiel, 2 tasks)

### Task A1 : trigger RBAC + Daily Sales + Purchase ×3 (migrations `_010..\_014`)

**Files :**
- Create : `supabase/migrations/20260624000010_create_audit_role_permissions_trigger.sql`
- Create : `supabase/migrations/20260624000011_create_get_daily_sales_v1_rpc.sql`
- Create : `supabase/migrations/20260624000012_create_get_purchase_items_v1_rpc.sql`
- Create : `supabase/migrations/20260624000013_create_get_purchase_by_date_v1_rpc.sql`
- Create : `supabase/migrations/20260624000014_create_get_purchase_by_supplier_v1_rpc.sql`
- Create : `supabase/tests/s40_reports.test.sql` (T1-T12)

- [ ] **A1.1 — Vérifier la base** : `list_migrations` → confirmer prior max NAME `20260623000012`. Lire le template S30 `20260524231049_create_get_payments_by_method_v1_rpc.sql` et la table `audit_logs` (`20260523000019_audit_logs_add_payload.sql`).

- [ ] **A1.2 — Migration `_010` trigger** (contenu complet) :

```sql
-- 20260624000010_create_audit_role_permissions_trigger.sql
-- S40 Wave A — audit trail on role_permissions grants/revokes.
-- Closes the RBAC observability gap: before this, only
-- role.session_timeout_changed was audited; permission grants were invisible.
CREATE OR REPLACE FUNCTION public.audit_role_permissions_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (auth.uid(), 'role.permission_granted', 'role', NULL,
            jsonb_build_object('role_code', NEW.role_code, 'permission_code', NEW.permission_code));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (auth.uid(), 'role.permission_revoked', 'role', NULL,
            jsonb_build_object('role_code', OLD.role_code, 'permission_code', OLD.permission_code));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_role_permissions ON public.role_permissions;
CREATE TRIGGER trg_audit_role_permissions
  AFTER INSERT OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_role_permissions_changes();

COMMENT ON FUNCTION public.audit_role_permissions_changes() IS
  'S40 — writes role.permission_granted / role.permission_revoked rows to audit_logs. '
  'actor_id is auth.uid() (NULL for seed/migration writes).';

REVOKE ALL ON FUNCTION public.audit_role_permissions_changes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_role_permissions_changes() FROM anon;
```

⚠️ Vérifier d'abord les noms réels des colonnes de `role_permissions` (`role_code`/`permission_code` vs `role_id`/`permission_id`) via `execute_sql` `SELECT column_name FROM information_schema.columns WHERE table_name='role_permissions'` — adapter le payload si besoin (déviation à noter).

- [ ] **A1.3 — Migration `_011` `get_daily_sales_v1`** (contenu complet — modèle canonique des 9 RPCs) :

```sql
-- 20260624000011_create_get_daily_sales_v1_rpc.sql
-- S40 — Daily Sales report. Gate reports.sales.read. CSV-only consumer.
CREATE OR REPLACE FUNCTION public.get_daily_sales_v1(
  p_date_start TEXT,
  p_date_end   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start DATE;
  v_end   DATE;
  v_tz    TEXT;
  v_summary JSONB;
  v_by_day  JSONB;
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
           ((o.paid_at AT TIME ZONE v_tz))::date AS day
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day,
           SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY 1
  ),
  days AS (
    SELECT vo.day,
           COUNT(*)::INT                          AS order_count,
           SUM(vo.total)::NUMERIC(14,2)           AS gross,
           COALESCE(MAX(dr.refund_total), 0)::NUMERIC(14,2) AS refunds
      FROM valid_orders vo
      LEFT JOIN day_refunds dr ON dr.day = vo.day
     GROUP BY vo.day
  )
  SELECT
    jsonb_build_object(
      'total',        COALESCE(SUM(gross), 0),
      'order_count',  COALESCE(SUM(order_count), 0),
      'aov',          CASE WHEN COALESCE(SUM(order_count),0) = 0 THEN 0
                           ELSE ROUND(SUM(gross) / SUM(order_count), 2) END,
      'refund_total', COALESCE(SUM(refunds), 0),
      'net',          COALESCE(SUM(gross), 0) - COALESCE(SUM(refunds), 0)
    ),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'date',        day,
        'order_count', order_count,
        'gross',       gross,
        'refunds',     refunds,
        'net',         gross - refunds,
        'aov',         CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END
      ) ORDER BY day
    ), '[]'::jsonb)
  INTO v_summary, v_by_day
  FROM days;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', v_start, 'end', v_end),
    'summary', v_summary,
    'by_day',  v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) IS
  'S40 — daily sales breakdown (gross/refunds/net/AOV per day). Gate reports.sales.read.';

REVOKE ALL ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) TO authenticated;
```

⚠️ Vérifier l'enum `order_status` réel (S33 : `draft, paid, voided, pending_payment, completed, b2b_pending`) et la colonne `refunds.total` (DEV-S32-1.A-03 : c'est `total`, pas `amount`).

- [ ] **A1.4 — Migration `_012` `get_purchase_items_v1(p_date_start TEXT, p_date_end TEXT, p_supplier_id UUID DEFAULT NULL)`** — gate `reports.inventory.read`. Même squelette que `_011` (gate/clamp/REVOKE pair identiques). Corps : lignes plates, PO non `draft`/`cancelled`, filtre supplier optionnel. Shape retour exact :
  ```json
  { "period": {"start","end"},
    "summary": {"line_count", "total_value"},
    "lines": [ { "po_id", "po_number", "order_date", "supplier_name",
                 "product_id", "product_name", "sku",
                 "quantity", "received_quantity", "unit_cost", "subtotal", "status" } ],
    "truncated": false }
  ```
  Tri `order_date DESC, po_number`, LIMIT 1000 (+1 fetch pour `truncated`). Jointures : `purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id JOIN suppliers s ON s.id = po.supplier_id JOIN products p ON p.id = poi.product_id` — vérifier les noms FK réels dans `20260517000110_init_purchase_orders.sql`.

- [ ] **A1.5 — Migration `_013` `get_purchase_by_date_v1(p_date_start TEXT, p_date_end TEXT)`** — gate `reports.inventory.read`. Agrégat par `order_date`. Shape :
  ```json
  { "period": {...},
    "summary": {"po_count", "total", "received_count", "pending_count"},
    "by_day": [ { "date", "po_count", "total", "received_total", "pending_total" } ] }
  ```
  `received_*` = PO `status='received'` ; `pending_*` = `status IN ('pending','partial')` ; `draft`/`cancelled` exclus partout.

- [ ] **A1.6 — Migration `_014` `get_purchase_by_supplier_v1(p_date_start TEXT, p_date_end TEXT)`** — gate `reports.inventory.read`. Shape :
  ```json
  { "period": {...},
    "by_supplier": [ { "supplier_id", "supplier_name", "po_count", "total",
                        "received_count", "cancelled_count", "avg_lead_days", "share_pct" } ] }
  ```
  `avg_lead_days` = `ROUND(AVG(received_date - order_date), 1)` sur PO received (NULL si aucun) ; `share_pct` = total supplier / total global × 100 arrondi 2 déc. (pattern share_pct de `get_payments_by_method_v1`) ; tri `total DESC`. Ici `cancelled` inclus dans `po_count`/`cancelled_count` mais exclu de `total`.

- [ ] **A1.7 — pgTAP T1-T12** dans `supabase/tests/s40_reports.test.sql` puis exécution via `execute_sql` (`BEGIN; ... ROLLBACK;`). Structure : seed minimal dans la tx (1 supplier + 1 PO 2 items received ; 2 orders paid J et J-1 + 1 refund ; 1 grant/revoke role_permissions sur un couple rôle/perm de test). Cas :
  - T1 : INSERT `role_permissions` → 1 row `audit_logs` `action='role.permission_granted'` payload role+perm.
  - T2 : DELETE → row `role.permission_revoked`.
  - T3/T4 : `get_daily_sales_v1` sans perm (set claims rôle CASHIER-like, pattern GUC des suites S25/S30) → `42501` ; avec perm → `summary.order_count = 2` et `by_day` longueur 2.
  - T5 : `get_daily_sales_v1` refunds décomptés (`net = gross - refund`).
  - T6/T7 : `get_purchase_items_v1` gate + shape (2 lignes, filtre `p_supplier_id` ramène 2, supplier inexistant ramène 0).
  - T8/T9 : `get_purchase_by_date_v1` gate + agrégat (`summary.po_count = 1`).
  - T10/T11 : `get_purchase_by_supplier_v1` gate + `share_pct = 100`.
  - T12 : `get_daily_sales_v1` end < start → P0001.
  Reprendre le harnais claims/GUC du fichier S30 `supabase/tests/bakery_reports.test.sql` (le lire avant).

- [ ] **A1.8 — Commit** : fichiers migrations + test SQL. `feat(db): session 40 — wave A1 — RBAC audit trigger + daily sales + purchase reports RPCs`.

### Task A2 : Staff + Production ×2 + Logs ×2 (migrations `_015..\_019`) + types regen

**Files :**
- Create : `supabase/migrations/20260624000015_create_get_staff_performance_v1_rpc.sql`
- Create : `supabase/migrations/20260624000016_create_get_production_report_v1_rpc.sql`
- Create : `supabase/migrations/20260624000017_create_get_production_efficiency_v1_rpc.sql`
- Create : `supabase/migrations/20260624000018_create_get_price_changes_v1_rpc.sql`
- Create : `supabase/migrations/20260624000019_create_get_permission_changes_v1_rpc.sql`
- Modify : `supabase/tests/s40_reports.test.sql` (T13-T22 ajoutés)
- Modify : `packages/supabase/src/types.generated.ts` (regen MCP)

- [ ] **A2.1 — Migration `_015` `get_staff_performance_v1(p_date_start TEXT, p_date_end TEXT)`** — gate `reports.sales.read`. Squelette `_011`. Shape :
  ```json
  { "period": {...},
    "by_staff": [ { "staff_id", "staff_name",
                    "orders_served", "revenue", "aov", "items_per_order",
                    "voids_count", "voids_value",
                    "refunds_count", "refunds_value",
                    "discount_orders_count", "discount_value",
                    "items_cancelled" } ] }
  ```
  CTEs séparées puis FULL OUTER JOIN par staff_id : (1) served : orders paid/completed non voided par `served_by`, revenue=SUM(total), items via `order_items` count/orders ; (2) voids : orders `voided_by` + `voided_at` dans range, value=SUM(total) ; (3) refunds : `refunds.refunded_by`, value=SUM(r.total) ; (4) discounts : orders servis avec `discount > 0` (vérifier nom col : `discount` sur orders — sinon adapter) ; (5) cancelled items : `order_items.cancelled_by`. `staff_name` = `user_profiles.full_name`. Tri `revenue DESC NULLS LAST`.

- [ ] **A2.2 — Migration `_016` `get_production_report_v1(p_date_start TEXT, p_date_end TEXT)`** — gate `reports.inventory.read`. Source `production_records pr WHERE pr.reverted_at IS NULL AND pr.production_date BETWEEN v_start AND v_end` (production_date est DATE — pas de conversion tz). Shape :
  ```json
  { "period": {...},
    "summary": {"runs", "total_produced", "total_waste", "total_value"},
    "by_product": [ { "product_id", "product_name", "qty_produced", "qty_waste", "value", "runs" } ],
    "by_day": [ { "date", "qty_produced", "qty_waste", "value" } ] }
  ```
  `value` = `qty_produced × products.cost_price` (cost courant — documenter dans COMMENT). Tri by_product `value DESC`.

- [ ] **A2.3 — Migration `_017` `get_production_efficiency_v1(p_date_start TEXT, p_date_end TEXT)`** — gate `reports.inventory.read`. Même source. Shape :
  ```json
  { "period": {...},
    "by_product": [ { "product_id", "product_name", "runs",
                      "avg_yield_variance_pct", "worst_variance_pct",
                      "waste_rate_pct", "has_variance_reasons" } ],
    "by_day": [ { "date", "avg_yield_variance_pct", "waste_rate_pct" } ] }
  ```
  `waste_rate_pct = ROUND(SUM(quantity_waste) / NULLIF(SUM(quantity_produced + quantity_waste), 0) * 100, 2)` ; `avg/worst_yield_variance_pct` depuis `yield_variance_pct` (GENERATED, peut être NULL → `AVG`/`MIN` ignorent NULL ; `worst` = MIN c.-à-d. le plus négatif) ; `has_variance_reasons` = `BOOL_OR(yield_variance_reason IS NOT NULL)`. Tri `waste_rate_pct DESC NULLS LAST`.

- [ ] **A2.4 — Migration `_018` `get_price_changes_v1`** (contenu complet — le LAG est le morceau délicat) :

```sql
-- 20260624000018_create_get_price_changes_v1_rpc.sql
-- S40 — retail price change history from audit_logs (product.update payload).
-- History only reaches back to the update_product_v1 era (S27). Variant edits
-- via update_variant_v1 do not emit product.update — documented limitation.
CREATE OR REPLACE FUNCTION public.get_price_changes_v1(
  p_date_start TEXT,
  p_date_end   TEXT,
  p_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start DATE; v_end DATE; v_tz TEXT;
  v_changes JSONB; v_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;
  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH price_events AS (
    -- ALL product.update events carrying retail_price, regardless of range:
    -- LAG needs the full per-product history so old_price is correct at the
    -- range boundary.
    SELECT al.entity_id                                   AS product_id,
           al.created_at,
           al.actor_id,
           (al.payload->>'retail_price')::NUMERIC(12,2)   AS new_price,
           LAG((al.payload->>'retail_price')::NUMERIC(12,2))
             OVER (PARTITION BY al.entity_id ORDER BY al.created_at, al.id) AS old_price
      FROM audit_logs al
     WHERE al.action = 'product.update'
       AND al.entity_type = 'product'
       AND al.payload ? 'retail_price'
       AND (p_product_id IS NULL OR al.entity_id = p_product_id)
  ),
  in_range AS (
    SELECT pe.*,
           ((pe.created_at AT TIME ZONE v_tz))::date AS day
      FROM price_events pe
     WHERE ((pe.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     ORDER BY pe.created_at DESC
     LIMIT 501
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'changed_at',   ir.created_at,
             'actor_name',   COALESCE(up.full_name, 'system'),
             'product_id',   ir.product_id,
             'product_name', COALESCE(p.name, '(deleted product)'),
             'new_price',    ir.new_price,
             'old_price',    ir.old_price,
             'delta_pct',    CASE WHEN ir.old_price IS NULL OR ir.old_price = 0 THEN NULL
                                  ELSE ROUND((ir.new_price - ir.old_price) / ir.old_price * 100, 2) END
           ) ORDER BY ir.created_at DESC
         ), '[]'::jsonb),
         COUNT(*)
    INTO v_changes, v_count
    FROM in_range ir
    LEFT JOIN user_profiles up ON up.id = ir.actor_id
    LEFT JOIN products p       ON p.id  = ir.product_id;

  IF v_count > 500 THEN
    v_changes := (SELECT jsonb_agg(e) FROM (
      SELECT e FROM jsonb_array_elements(v_changes) e LIMIT 500
    ) t);
  END IF;

  RETURN jsonb_build_object(
    'period',    jsonb_build_object('start', v_start, 'end', v_end),
    'changes',   v_changes,
    'truncated', v_count > 500
  );
END;
$$;

COMMENT ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) IS
  'S40 — retail_price change log from audit_logs product.update payloads, '
  'old_price via LAG over full per-product history. Gate reports.financial.read.';

REVOKE ALL ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_price_changes_v1(TEXT, TEXT, UUID) TO authenticated;
```

⚠️ Vérifier sur le cloud le format réel du payload de `update_product_v1` (`SELECT payload FROM audit_logs WHERE action='product.update' LIMIT 3`) : si le patch est imbriqué (ex. `payload->'patch'->>'retail_price'`), adapter les 2 expressions et noter la déviation.

- [ ] **A2.5 — Migration `_019` `get_permission_changes_v1(p_date_start TEXT, p_date_end TEXT)`** — gate `audit_log.read`. Squelette `_018` sans LAG. Source : `audit_logs WHERE action IN ('role.permission_granted','role.permission_revoked','role.session_timeout_changed','pin.locked')` + range tz + LIMIT 501/truncated. Shape :
  ```json
  { "period": {...},
    "changes": [ { "changed_at", "actor_name", "action",
                   "role_code", "permission_code", "detail" } ],
    "truncated": false }
  ```
  `role_code` = `payload->>'role_code'` ; `permission_code` = `payload->>'permission_code'` (NULL pour timeout/pin) ; `detail` = `payload` passthrough ; `actor_name` = `COALESCE(up.full_name, 'system')`. Tri `created_at DESC`.

- [ ] **A2.6 — pgTAP T13-T22** (étendre le fichier, ré-exécuter la suite ENTIÈRE T1-T22) :
  - T13/T14 : `get_staff_performance_v1` gate + shape (seed : 2 orders servis par staff A, 1 void par staff B → A.orders_served=2, B.voids_count=1).
  - T15/T16 : `get_production_report_v1` gate + agrégat (seed 1 production_record qty 10 waste 2 → summary.total_produced=10).
  - T17/T18 : `get_production_efficiency_v1` gate + `waste_rate_pct` arrondi attendu (2/(10+2)×100 = 16.67).
  - T19/T20 : `get_price_changes_v1` gate + **LAG correct** : seed 2 rows audit_logs `product.update` (prix 1000 puis 1500) → le row le plus récent a `old_price=1000, new_price=1500, delta_pct=50` ; filtre `p_product_id` opérant.
  - T21/T22 : `get_permission_changes_v1` gate + retrouve les rows T1/T2 du trigger (grant+revoke seedés dans la tx).

- [ ] **A2.7 — Types regen** : `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`. `pnpm --filter @breakery/supabase typecheck` (ou `pnpm typecheck`) PASS.

- [ ] **A2.8 — Commit** : `feat(db): session 40 — wave A2 — staff/production/logs reports RPCs + types regen`.

---

## Wave B — Backoffice hooks + pages + smokes (3 × `backoffice-specialist` en PARALLÈLE)

**Modèle commun** (chaque report suit exactement ceci — adapter noms/colonnes) :

Hook modèle — `apps/backoffice/src/features/reports/hooks/useDailySales.ts` :
```tsx
// S40 — Query hook for get_daily_sales_v1 RPC.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface DailySalesRow {
  date: string; order_count: number; gross: number;
  refunds: number; net: number; aov: number;
}
export interface DailySalesData {
  period:  { start: string; end: string };
  summary: { total: number; order_count: number; aov: number; refund_total: number; net: number };
  by_day:  DailySalesRow[];
}
export function useDailySales(params: { start: string; end: string }) {
  return useQuery<DailySalesData, Error>({
    queryKey: ['reports', 'daily-sales', params.start, params.end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_daily_sales_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      return data as unknown as DailySalesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
```
(Si le typage généré ne connaît pas encore le RPC dans cette branche de types, utiliser le cast `(supabase as any).rpc(...)` pattern S30 `useWastageReport` avec le eslint-disable — choisir ce que le typecheck accepte.)

Page modèle — `apps/backoffice/src/pages/reports/DailySalesPage.tsx` : copier la structure EXACTE de `WastagePage.tsx` (lue en référence) avec :
- `ReportPage title="Daily Sales" subtitle="Per-day gross, refunds, net and average order value."`
- `DateRangePicker` + `ExportButtons` **CSV uniquement** (prop `pdf` ABSENTE) : `csv={{ rows: byDay, columns: csvColumns, filename: \`daily-sales-${start}_${end}\` }}`.
- KPI cards (div flex de `Card` `@breakery/ui`) au-dessus de la table quand `summary` existe : Total (IDR), Orders, AOV, Refunds, Net.
- Table sémantique mêmes classes que WastagePage (`border-border-subtle`, `text-text-secondary`, `tabular-nums`, IDR via `toLocaleString('id-ID', …)`).
- Drill-down : la cellule date → `<Link to={buildDrilldownUrl('order_list', null, { start: r.date, end: r.date })}>` — vérifier la signature réelle de `buildDrilldownUrl` (`packages/…/buildDrilldownUrl` ou `features/reports/lib`) et l'usage existant entity `order_list` (S32) avant d'écrire ; si l'API diffère, suivre l'existant.
- Empty state row `colSpan` « No sales for this period. ».

Smoke modèle — `apps/backoffice/src/pages/reports/__tests__/daily-sales-page.smoke.test.tsx` : copier le harnais d'un smoke S30 (chercher `wastage` ou `payment-by-method` dans `apps/backoffice/src/**/__tests__/*.smoke.test.tsx` ; reprendre mocks authStore/supabase + `MemoryRouter`) avec 2 cas :
1. render avec RPC mocké (fixture JSON conforme au shape) → titre page + un agrégat affiché (ex. `Rp` formaté) + bouton export CSV présent.
2. RPC mocké en erreur 42501 ou perm absente du store → contenu bloqué (selon le pattern du smoke copié : PermissionGate est route-level, donc tester l'affichage `role="alert"` de l'erreur RPC).

**Définition des 3 tasks parallèles :**

### Task B1 : Daily Sales + Staff Performance
**Files :** Create `features/reports/hooks/useDailySales.ts`, `features/reports/hooks/useStaffPerformance.ts`, `pages/reports/DailySalesPage.tsx`, `pages/reports/StaffPerformancePage.tsx`, 2 smokes `__tests__/daily-sales-page.smoke.test.tsx` + `staff-performance-page.smoke.test.tsx` (tous sous `apps/backoffice/src/`).

- [ ] B1.1 Hook + page + smoke Daily Sales (modèle ci-dessus tel quel). Colonnes CSV : Date/Orders/Gross (idr-round100)/Refunds/Net/AOV.
- [ ] B1.2 Hook + page + smoke Staff Performance. Interface = shape `_015`. Colonnes table+CSV : Staff / Orders / Revenue / AOV / Items-per-order / Voids (count + value) / Refunds (count + value) / Discount orders (count + value) / Items cancelled. Pas de drill-down (terminal — `served_by` non supporté par les filtres orders v2, vérifier `useOrdersList`/`get_orders_list_v2` ; si supporté, lien `/backoffice/orders?served_by=`).
- [ ] B1.3 `pnpm --filter @breakery/app-backoffice test daily-sales staff-performance` PASS ; commit `feat(backoffice): session 40 — wave B1 — daily sales + staff performance report pages`.

### Task B2 : Purchase Items + Purchase by Date + Purchase by Supplier
**Files :** Create 3 hooks `usePurchaseItems.ts` / `usePurchaseByDate.ts` / `usePurchaseBySupplier.ts`, 3 pages `PurchaseItemsPage.tsx` / `PurchaseByDatePage.tsx` / `PurchaseBySupplierPage.tsx`, 3 smokes.

- [ ] B2.1 Purchase Items : filtre supplier = `<select>` natif (PAS de Select `@breakery/ui` — non exporté) alimenté par un mini-hook inline `useQuery(['suppliers-options'], …)` SELECT `id, name` sur `suppliers` actifs via PostgREST. Param `p_supplier_id` nullable. Colonnes : PO# / Date / Supplier / Product / SKU / Qty / Received / Unit cost / Subtotal / Status. Banner discret si `truncated` (« First 1000 rows — narrow the range »).
- [ ] B2.2 Purchase by Date : KPI cards (PO count / Total / Received / Pending) + table by_day. 
- [ ] B2.3 Purchase by Supplier : table by_supplier avec share_pct (`%` 2 déc.) et avg_lead_days (« — » si NULL). Terminal (pas de page supplier detail — documenté).
- [ ] B2.4 Tests filtrés PASS ; commit `feat(backoffice): session 40 — wave B2 — purchase reports pages ×3`.

### Task B3 : Production Report + Production Efficiency + Price Changes + Permission Change Log
**Files :** Create 4 hooks `useProductionReport.ts` / `useProductionEfficiency.ts` / `usePriceChanges.ts` / `usePermissionChanges.ts`, 4 pages `ProductionReportPage.tsx` / `ProductionEfficiencyPage.tsx` / `PriceChangesPage.tsx` / `PermissionChangesPage.tsx`, 4 smokes.

- [ ] B3.1 Production Report : KPI (Runs / Produced / Waste / Value) + table by_product (drill `DrilldownLink entity="product"` comme WastagePage) + table by_day en dessous.
- [ ] B3.2 Production Efficiency : table by_product (variance % colorée : rouge si < -10, vert si ≥ 0) + table by_day trend. Valeurs NULL → « — ».
- [ ] B3.3 Price Changes : filtre produit optionnel (réutiliser le pattern select natif de B2.1 sur `products` actifs, search non requis) ; colonnes Date / Product / Actor / Old → New (IDR) / Δ% (badge rouge/vert) ; old NULL → « first recorded ». `truncated` banner.
- [ ] B3.4 Permission Change Log : colonnes Date / Actor / Action (badge par type) / Role / Permission / Detail (`<code>` JSON compact). Empty state explicite.
- [ ] B3.5 Tests filtrés PASS ; commit `feat(backoffice): session 40 — wave B3 — production + logs report pages ×4`.

---

## Wave C — Wiring + sweeps (1 × `backoffice-specialist`, après B1+B2+B3)

**Files :**
- Modify : `apps/backoffice/src/routes/index.tsx`
- Modify : `apps/backoffice/src/layouts/Sidebar.tsx`
- Modify : `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx`
- Modify : smoke hub existant (chercher le test qui compte les cards/Soon : `apps/backoffice/src/pages/reports/__tests__/` ou `features/reports/__tests__/`)

- [ ] **C1 — Routes** : 9 routes lazy sous le bloc reports existant de `routes/index.tsx`, chacune dans `<PermissionGate required="…">` : `daily-sales`+`staff-performance` → `reports.sales.read` ; `purchase-items`+`purchase-by-date`+`purchase-by-supplier`+`production-report`+`production-efficiency` → `reports.inventory.read` ; `price-changes` → `reports.financial.read` ; `permission-changes` → `audit_log.read` (vérifier le code exact dans `PermissionCode` — l'AuditPage S13 utilise déjà ce gate, copier le sien).
- [ ] **C2 — Sidebar** : 9 entrées dans le groupe Reports, mêmes sous-groupes que le hub (Sales / Purchase / Operations / Logs selon la structure réelle des sous-groupes S30 — lire `Sidebar.tsx:130-160` et insérer au bon sous-groupe avec `permission`). Icons : Calendar, ShoppingCart, Calendar, Truck, Users, BarChart3, TrendingUp, ListChecks, Shield (mêmes que le hub).
- [ ] **C3 — Hub** : les 9 cards gagnent `to:` (slugs de C1) et perdent « (Soon) » du blurb. Plus AUCUNE card sans `to` dans le fichier.
- [ ] **C4 — Smoke hub** : mettre à jour le test existant (0 tuiles « Soon », compte de liens actifs 27) ; si aucun test hub n'existe, en créer un minimal `reports-index.smoke.test.tsx` (2 cas : 27 links, 0 Soon).
- [ ] **C5 — Sweeps** : `pnpm --filter @breakery/app-backoffice test` complet + `pnpm typecheck` (6/6). Baseline flakes connue : BO `journal-entries` T1 (DEV-S39-D2-01) — re-run isolé si touché.
- [ ] **C6 — Commit** : `feat(backoffice): session 40 — wave C — wire 9 report routes/sidebar/hub, zero Soon cards`.

---

## Wave D — Close-out (lead)

- [ ] **D1 — pattern-guardian** : agent `pattern-guardian` sur `git diff master...swarm/session-40` — 0 violation attendue (points d'attention : REVOKE pairs ×9 + trigger function revoked, aucune écriture directe ledger, domain IO-free non touché).
- [ ] **D2 — Sweeps transverses** : domain + UI + POS (non-régression, baseline DEV-S39-D2-01) + BO + typecheck 6/6.
- [ ] **D3 — E2E navigateur** `tests/e2e/s40-reports.spec.ts` (Playwright, copier le harnais login de `tests/e2e/s39-bo-completion.spec.ts` — login PIN partagé `beforeAll`, rate-limit 3/min/IP) :
  - T1 : `/backoffice/reports` → 0 texte « Soon », ≥ 27 cards-links.
  - T2 : Daily Sales → range couvrant des ventes seedées → table non vide + KPI ; clic export CSV → download non vide.
  - T3 : Purchase by Supplier → table ou empty state propre (pas d'erreur console).
  - T4 : Permission Change Log → rows historiques (`role.session_timeout_changed`/`pin.locked`) ou empty state ; pas de grant/revoke live (couvert pgTAP T1/T2).
  - Captures `test-results/s40-t1..t4.png`. Lancer les apps localement (`pnpm --filter @breakery/app-backoffice dev`) comme S39.
- [ ] **D4 — INDEX** : `docs/workplan/plans/2026-06-12-session-40-INDEX.md` (waves/statuts, migrations, déviations DEV-S40-*, critères cochés).
- [ ] **D5 — CLAUDE.md** : §Active Workplan — S40 devient « Current session », S39 descend en référence ; §Migration sequence — bloc `20260624000010..019` documenté.
- [ ] **D6 — PR** : push + `gh pr create` vers `master` (squash à la merge), body = résumé waves + tests + 🤖 footer.

---

## Self-review du plan (fait à l'écriture)

- Spec coverage : 10 migrations ✔ (A1 ×5 + A2 ×5), 9 hooks/pages/smokes ✔ (B1 ×2 + B2 ×3 + B3 ×4), wiring ✔ (C), trigger ✔ (A1.2 + pgTAP T1/T2), E2E ✔ (D3), pgTAP 22 cas ✔ (T1-T12 + T13-T22), types regen ✔ (A2.7), CSV-only ✔ (prop pdf absente partout), drill-down Daily Sales ✔ (B/modèle).
- Cohérence types : shapes JSONB des RPCs == interfaces hooks == colonnes pages (vérifié par task).
- Points à vérifier en cours d'exécution (signalés ⚠ dans les tasks) : colonnes `role_permissions`, enum `order_status`, FK purchase, format payload `product.update`, col discount orders, signature `buildDrilldownUrl`.
