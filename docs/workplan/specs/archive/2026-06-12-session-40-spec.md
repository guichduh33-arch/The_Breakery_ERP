# Session 40 — Spec : Reports close-out — les 9 cards « Soon » du hub

- **Date** : 2026-06-12
- **Branche** : `swarm/session-40` (base `master` @ `e3ec866`, post-merge S39 PR #72)
- **Sources** : CLAUDE.md §Active Workplan (« Hors scope S40+ » de S30/S38/S39 — BO-21), `docs/audit/2026-05-28-pos-audit.md` (sans objet ici), hub `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` (9 cards « Soon » restantes).
- **Décisions de cadrage (brainstorming 2026-06-12)** :
  1. Périmètre = **les 9 cards « Soon »**, BO-08 (CF account drill) re-déféré (refactor accounting d'une autre nature).
  2. **CSV-only** cette session — EF `generate-pdf` **intouchée** (PDF des 9 reports déféré S41+).
  3. Price Changes lit `audit_logs` (`product.update`) avec fenêtrage LAG — pas de table `price_history` matérialisée.
  4. **1 trigger d'audit sur `role_permissions`** (INSERT/DELETE) ajouté pour rendre Permission Change Log réel — bonus traçabilité sécurité.

---

## 1. Contexte

Le hub Reports (`ReportsIndexPage`) affiche 27 cards dont **9 désactivées « Soon »** depuis S30 :
Daily Sales, Purchase Items, Purchase by Date, Purchase by Supplier, Staff Performance, Production Report, Production Efficiency, Price Changes, Permission Change Log.

Toutes les sources de données existent déjà en DB (vérifié 2026-06-12) :
- `purchase_orders` / `purchase_order_items` / `goods_receipt_notes` / `suppliers` (S13/S17).
- `orders.served_by` → `user_profiles` ; `orders.voided_by`, `refunds.refunded_by`/`authorized_by` ; `order_items.cancelled_by`.
- `production_records` (qty produced/waste, `expected_yield_qty`, `actual_yield_qty`, `yield_variance_pct` GENERATED, `yield_variance_reason`, lifecycle flags) + `production_batches`.
- `audit_logs` (`actor_id`, `action`, `entity_type`, `entity_id`, `metadata`, `payload`, `created_at`) — `product.update` écrit par `update_product_v1` (payload = patch JSONB appliqué).
- **Gap connu** : aucun audit sur les writes `role_permissions` (seul `role.session_timeout_changed` existe) → traité par le trigger de cette session.

**Différenciation Staff Performance vs Sales by Staff (S13)** : `get_sales_by_staff_v1` couvre déjà revenue/order_count/avg_basket. La nouvelle card est orientée **contrôle & anti-fraude** : voids, refunds, discounts, items annulés par staff, en plus du volume servi. Pas de doublon.

## 2. Périmètre DB (Wave A) — 10 migrations bloc `20260624000010..`

Pattern S30 canonique pour chaque RPC : `SECURITY DEFINER`, `SET search_path = public, pg_temp`, gate `has_permission(auth.uid(), '<perm>')` → `42501` sinon, retour `JSONB` (`jsonb_build_object`), `STABLE`, + **REVOKE pair S25** (REVOKE ALL FROM PUBLIC + REVOKE EXECUTE FROM anon + GRANT authenticated, et `ALTER DEFAULT PRIVILEGES` déjà couvert par S20/S25 — pas de nouveau besoin). Dates en `TEXT 'YYYY-MM-DD'` clampées comme S30 (`get_payments_by_method_v1` = template, migration `20260524231049`). Timezone : bucketing via `business_config.timezone` (pattern S13/S30).

**Aucune nouvelle table. Aucune nouvelle permission seedée. EF intouchée.**

| # | Migration | Contenu |
|---|---|---|
| `_010` | `create_audit_role_permissions_trigger` | Trigger function `audit_role_permissions_changes()` AFTER INSERT/DELETE sur `role_permissions` → `audit_logs` (`action` = `role.permission_granted` / `role.permission_revoked`, `entity_type='role'`, `entity_id=NULL`, `payload = {role_code, permission_code}`, `actor_id = auth.uid()` nullable — writes de seed/migration ont actor NULL). |
| `_011` | `create_get_daily_sales_v1_rpc` + REVOKE pair | `get_daily_sales_v1(p_date_start TEXT, p_date_end TEXT)` — gate `reports.sales.read`. Retour : `summary` (total, order_count, aov, refund_total, net) + `by_day[]` (date, order_count, gross, refunds, net, aov). Source : orders `status IN ('paid','completed')` non voided ; refunds par jour depuis `refunds`. |
| `_012` | `create_get_purchase_items_v1_rpc` + REVOKE pair | `get_purchase_items_v1(p_date_start TEXT, p_date_end TEXT, p_supplier_id UUID DEFAULT NULL)` — gate `reports.inventory.read`. Lignes `purchase_order_items` × PO (non-draft, non-cancelled) × suppliers × products : po_number, order_date, supplier_name, product_name, sku, quantity, received_quantity, unit_cost, subtotal, status. Tri date DESC. Cap 1000 lignes + `truncated` flag. |
| `_013` | `create_get_purchase_by_date_v1_rpc` + REVOKE pair | `get_purchase_by_date_v1(p_date_start TEXT, p_date_end TEXT)` — gate `reports.inventory.read`. `summary` (po_count, total, received_count, pending_count) + `by_day[]` (date, po_count, total, received_total, pending_total). |
| `_014` | `create_get_purchase_by_supplier_v1_rpc` + REVOKE pair | `get_purchase_by_supplier_v1(p_date_start TEXT, p_date_end TEXT)` — gate `reports.inventory.read`. `by_supplier[]` (supplier_id, supplier_name, po_count, total, received_count, cancelled_count, avg_lead_days = AVG(received_date - order_date) sur les PO received, share_pct). |
| `_015` | `create_get_staff_performance_v1_rpc` + REVOKE pair | `get_staff_performance_v1(p_date_start TEXT, p_date_end TEXT)` — gate `reports.sales.read`. `by_staff[]` (staff_id, staff_name, orders_served, revenue, aov, items_per_order, voids_initiated {count,value} par `orders.voided_by`, refunds_processed {count,value} par `refunds.refunded_by`, discount_orders {count,value} sur orders servis avec discount > 0, items_cancelled par `order_items.cancelled_by`). Fenêtre : `paid_at` (revenue) / `voided_at`, `refunds.created_at`, `cancelled_at` (événements) dans le range. |
| `_016` | `create_get_production_report_v1_rpc` + REVOKE pair | `get_production_report_v1(p_date_start TEXT, p_date_end TEXT)` — gate `reports.inventory.read`. `summary` (batches, total_produced, total_waste, total_value au `products.cost_price` courant) + `by_product[]` (product_id, name, qty_produced, qty_waste, value, runs) + `by_day[]` (date, qty_produced, qty_waste, value). Source `production_records` non reverted (`reverted_at IS NULL`). |
| `_017` | `create_get_production_efficiency_v1_rpc` + REVOKE pair | `get_production_efficiency_v1(p_date_start TEXT, p_date_end TEXT)` — gate `reports.inventory.read`. `by_product[]` (product_id, name, runs, avg_yield_variance_pct, waste_rate_pct = waste/(produced+waste)*100, worst_variance_pct, has_variance_reasons bool) + `by_day[]` trend (date, avg_yield_variance_pct, waste_rate_pct). Même filtre reverted. |
| `_018` | `create_get_price_changes_v1_rpc` + REVOKE pair | `get_price_changes_v1(p_date_start TEXT, p_date_end TEXT, p_product_id UUID DEFAULT NULL)` — gate `reports.financial.read`. Source `audit_logs` `action='product.update' AND payload ? 'retail_price'` (+ `product.create` comme baseline si payload contient retail_price). `changes[]` (changed_at, actor_name via LEFT JOIN user_profiles, product_id, product_name via LEFT JOIN products — produits supprimés tolérés (name NULL → 'deleted product'), new_price, old_price via LAG(new_price) OVER (PARTITION BY entity_id ORDER BY created_at) — NULL si premier event connu, delta_pct nullable). Cap 500 + `truncated` flag. **Limite documentée** : l'historique ne remonte qu'à l'ère `update_product_v1` (S27) ; les variants modifiés via `update_variant_v1` n'émettent pas `product.update` → hors périmètre, documenter en déviation si confirmé. |
| `_019` | `create_get_permission_changes_v1_rpc` + REVOKE pair | `get_permission_changes_v1(p_date_start TEXT, p_date_end TEXT)` — gate `audit_log.read`. Source `audit_logs` `action IN ('role.permission_granted','role.permission_revoked','role.session_timeout_changed','pin.locked')`. `changes[]` (changed_at, actor_name nullable → 'system', action, role_code (payload), permission_code (payload, NULL pour timeout/pin), detail JSONB passthrough payload). Cap 500 + `truncated`. |

Post-Wave A : **types regen** via MCP → `packages/supabase/src/types.generated.ts`, committé.

### pgTAP — `supabase/tests/s40_reports.test.sql` (~22 cas, via cloud MCP `execute_sql` BEGIN/ROLLBACK)

- T1-T2 : trigger `role_permissions` — INSERT seedé puis DELETE → 2 rows `audit_logs` avec payload attendu.
- T3-T20 : par RPC (9×2) — (a) perm gate : rôle sans la perm → `42501` ; (b) shape : clés JSONB top-level présentes + agrégat cohérent sur données seedées dans la tx.
- T21-T22 : clamp dates invalides (pattern S30) + `get_price_changes_v1` LAG correct sur 2 updates successifs d'un même produit (old_price du 2e = new_price du 1er).

## 3. Périmètre Backoffice (Wave B)

Pour chacun des 9 reports : **hook** (`apps/backoffice/src/features/reports/hooks/` — suivre l'emplacement réel des hooks S30) + **page** (`apps/backoffice/src/pages/reports/`) + **route** `PermissionGate` + **entrée sidebar** (groupe Reports, même indentation que S30) + **card hub activée**.

- **Hooks** : `useQuery` keyed `['report-<slug>', start, end, ...filters]`, RPC via client Supabase typé. Pattern = hooks S30 (`usePaymentsByMethod`).
- **Pages** : `DateRangePicker` standard du hub + tables sémantiques projet + `ExportButtons` **CSV-only** (`buildCsv`/`downloadCsv` de `@breakery/domain`, pattern StockMovementHistory S30 — prop PDF absente/désactivée). KPI cards en tête où le summary existe (Daily Sales, Purchase by Date, Production Report).
- **Filtres spécifiques** : Purchase Items → select supplier (depuis `suppliers` actifs) ; Price Changes → select produit optionnel.
- **Drill-down** (là où le pattern existe) : Daily Sales `by_day` row → `/backoffice/orders?start=<day>&end=<day>` via `buildDrilldownUrl` entity `order_list` ; Staff Performance row → `/backoffice/orders?served_by=<id>` **si** le filtre `served_by` est supporté par `get_orders_list_v2` (vérifier ; sinon terminal documenté). Les autres reports : terminaux documentés.
- **Hub** : `ReportsIndexPage` — les 9 cards passent actives (`href` + suppression « (Soon) » du blurb) ; **plus aucune card « Soon »** ; le compteur de tests smoke du hub est mis à jour.
- **Routes** : 9 nouvelles sous `/backoffice/reports/...` : `daily-sales`, `purchase-items`, `purchase-by-date`, `purchase-by-supplier`, `staff-performance`, `production-report`, `production-efficiency`, `price-changes`, `permission-changes`.

### Smokes BO (~9 fichiers × 2 cas)

Par page : (1) render avec mock RPC → titres/colonnes/KPI visibles ; (2) perm manquante → page bloquée (`PermissionGate`). Pattern fichiers smoke S30. Mise à jour du smoke hub (cards actives 18→27, 0 Soon).

## 4. Tests transverses & E2E (Waves C/D)

- Sweeps : `pnpm --filter @breakery/app-backoffice test` + domain + UI + POS (non-régression) + `pnpm typecheck` 6/6.
- Baseline connue : 2 flakes pré-existants sous charge (DEV-S39-D2-01 — POS `variant-select-modal`, BO `journal-entries` T1) — ne pas confondre avec une régression.
- **E2E navigateur** `tests/e2e/s40-reports.spec.ts` (Playwright, login PIN partagé `beforeAll` — rate-limit `auth-verify-pin` 3/min/IP, pattern S39) :
  - T1 : hub Reports → **0 card « Soon »**, 27 cards actives.
  - T2 : Daily Sales → données rendues sur un range contenant des ventes seedées + export CSV téléchargé non vide.
  - T3 : Purchase by Supplier → table rendue (ou empty state propre si pas de PO seedé).
  - T4 : Permission Change Log → au moins les rows `role.session_timeout_changed`/`pin.locked` historiques ou empty state ; si un grant/revoke de test est jouable sans risque, vérifier le trigger en live (sinon couvert pgTAP).
- pattern-guardian sur le diff complet avant PR.

## 5. Workflow

- Waves : **A** (DB, `db-engineer`) → **B** (3 × `backoffice-specialist` en parallèle : B1 sales+staff [daily-sales, staff-performance], B2 purchase ×3, B3 production ×2 + logs ×2) → **C** (wiring hub/routes/sidebar si non porté par B, sweeps, fixes) → **D** (lead : pattern-guardian, E2E navigateur, INDEX, CLAUDE.md, PR).
- Chaque task Wave A/B : dev subagent + **revue spec** (+ revue qualité sur les tasks à risque) avant de passer à la suivante, pattern S39.
- Commits conventionnels par task, squash-merge PR vers `master` en fin de session.
- INDEX : `docs/workplan/plans/2026-06-12-session-40-INDEX.md` (waves, migrations, déviations numérotées DEV-S40-*, critères).

## 6. Hors scope S41+

PDF templates des 9 reports (registry generate-pdf 17→26), BO-08 CF account drill, page supplier detail (drill Purchase by Supplier), price history matérialisé, audit `update_variant_v1` → `product.update` (si gap confirmé), compare toggle sur les 9 nouveaux reports, dé-flake DEV-S39-D2-01, PAT-01/02, POS-16/17, F-010..013/019..024.

## 7. Critères d'acceptation

- [ ] 10 migrations appliquées (trigger + 9 RPCs + REVOKE pairs) ; types regen committé ; **zéro nouvelle table/permission ; EF intouchée**.
- [ ] Trigger RBAC : grant/revoke → rows `audit_logs` vérifiées (pgTAP).
- [ ] pgTAP ~22/22 PASS via cloud MCP.
- [ ] 9 pages BO fonctionnelles : hook + page + route gated + sidebar + card hub active ; CSV export sur chaque page ; smokes ~18 PASS.
- [ ] Hub : 0 card « Soon ».
- [ ] Sweeps domain/UI/POS/BO PASS (hors baseline flakes documentée) ; typecheck 6/6.
- [ ] E2E navigateur T1-T4 PASS (captures dans `test-results/`).
- [ ] pattern-guardian : 0 violation.
- [ ] INDEX rempli + CLAUDE.md §Active Workplan bumpé + PR créée vers `master`.
