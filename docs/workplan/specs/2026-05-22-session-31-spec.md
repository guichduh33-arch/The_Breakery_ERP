# Session 31 — Reports Drill-Down transverse + 3 detail pages (Spec)

> **Date** : 2026-05-22
> **Branche cible** : `swarm/session-31`
> **Base** : `master` après merge S30 (`60a1ff3`)
> **Effort estimé** : ~2-3 jours wall-time (L)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-24-session-30-spec.md`](./2026-05-24-session-30-spec.md) — S31 enchaîne sur Vague B (5 nouveaux reports) avec le **premier chantier Vague C : drill-down navigation transverse**.

---

## 1. Contexte

Post-S30, le module Reports compte **18 pages actives** (17 reports + ZReportsListPage). Toutes les pages affichent des cells riches (product_id, account_id, user_id, category_id, recipe_id, payment_method, hour bucket…) **sans aucun lien sortant** — l'utilisateur lit la donnée mais ne peut pas naviguer vers la source.

Vague C inclut 6 chantiers transverses (drill-down, UnifiedReportFilters extra dims, compare toggle étendu, hub KPI bar, favorites/pinning, mobile responsive). **S31 traite uniquement le drill-down** — chantier le plus haute valeur UX et le plus indépendant des autres.

**Périmètre transverse complet** : toutes entités rencontrées dans les 17 reports (product, category, user, customer, order, recipe, account, supplier, expense, purchase_order) reçoivent un drill-down vers leur page detail/list.

**Gap structurel identifié** : 3 entités n'ont pas de page detail BO aujourd'hui :
- ❌ `customers/:id` — pas de detail customer (existe seulement `/customers` list)
- ❌ `orders/:id` — pas de detail order ; pas de `/orders` du tout
- ❌ `inventory/recipes/:id` — pas de detail recipe (existe seulement liste `/inventory/recipes`)

Décision ratifiée : **S31 crée les 3 pages détail minimales read-only** pour atteindre la vraie full coverage drill-down. Pages, list filtrable et actions étendues (refund/void/edit) restent backlog S32+.

**Hors scope S31** (renvoyé Vague C suite ou backlog) :
- UnifiedReportFilters extra dims category/terminal/customer
- Compare toggle sur les 5 reports S30
- Hub mini-KPI bar + favorites/pinning
- Mobile responsive
- 6 Soon cards restantes (Daily Sales, Purchase ×3, Production Report, Staff Performance, Price Changes, Permission Change Log)
- Pages **list** filtrables qui n'existent pas (`/backoffice/orders` list, `/recipes` list standalone)
- Actions sur detail pages (refund/void sur order, edit recipe, edit customer)
- Drill récursif profond (limité à 2 niveaux : report → detail ; le detail peut drill mais c'est UX, pas scope wiring)

---

## 2. Architecture

**Choix structurant 1** : **Composant entity-aware unifié** `<DrilldownLink entity={...} id={...} filter={...} />`. Le composant connaît les routes BO par entity type. Une seule source de vérité pour les routes drill-down (si une route change, 1 endroit à bumper).

**Choix structurant 2** : **Helper pur séparé** `buildDrilldownUrl(entity, id, filter)` — testable unitairement, return `string | null`. Si entity n'a pas de cible (terminal cell), retourne `null` → le composant rend texte plain.

**Choix structurant 3** : **Convention URL** :
- Detail : `/backoffice/<entity-plural>/<id>`
- List filtrée : `/backoffice/<entity-plural>?<dim>=<value>&date_from=<iso>&date_to=<iso>`
- Le report passe son `date_from/date_to` courant via `filter` aux drilldowns quand applicable (pré-rempli côté pages cible si elles le supportent)

**Choix structurant 4** : **Pas de RPC nouvelle** — les 3 detail pages utilisent direct SELECT PostgREST avec embeds (RLS authenticated suffit pour lecture). Aucun nouveau DDL côté tables ; seule migration = 1 seed permission `orders.read`.

**Choix structurant 5** : **Component location** = `apps/backoffice/src/features/reports/components/DrilldownLink.tsx` (BO-specific, connaît les routes BO — n'a pas vocation à être partagé avec POS).

**Choix structurant 6** : **Cells terminales** (no viable target — date isolée, payment_method sans liste filtrable existante, hour bucket sans /orders, version recipe terminale) → restent texte plain, pas de DrilldownLink wrap.

### 2.1 Routes cibles vérifiées (audit Explore)

| Entity | Route existante | Notes S31 |
|---|---|---|
| product | `/backoffice/products/:productId` | ✓ |
| category | `/backoffice/categories` (list) | Drill via `/products?category_id=X` |
| user | `/backoffice/users/:id` | ✓ |
| supplier | `/backoffice/suppliers/:id` | ✓ |
| expense | `/backoffice/expenses/:id` | ✓ |
| purchase_order | `/backoffice/purchasing/purchase-orders/:id` | ✓ |
| account | `/backoffice/accounting/general-ledger` | Query param `?account_id=X` (S26b supporte) |
| **customer** | `/backoffice/customers` (list only) | ❌ **NEW S31 : `/backoffice/customers/:id`** |
| **order** | (aucune) | ❌ **NEW S31 : `/backoffice/orders/:id`** |
| **recipe** | `/backoffice/inventory/recipes` (list) | ❌ **NEW S31 : `/backoffice/inventory/recipes/:id`** |

---

## 3. Composant + util (Wave 1)

### 3.1 `buildDrilldownUrl.ts` (helper pur)

Signature :
```ts
export type DrilldownEntity =
  | 'product' | 'category' | 'user' | 'customer' | 'order' | 'recipe'
  | 'account' | 'supplier' | 'expense' | 'purchase_order';

export interface DrilldownFilter {
  date_from?: string;       // ISO date
  date_to?: string;
  category_id?: string;
  payment_method?: string;
  movement_type?: string;
  created_by?: string;
  hour_from?: number;
  hour_to?: number;
}

export function buildDrilldownUrl(
  entity: DrilldownEntity,
  id: string,
  filter?: DrilldownFilter,
): string | null;
```

Comportement :
- Map entity → route template (detail si `id` est valide UUID, sinon list filtrée)
- Append `filter` non-undefined via `URLSearchParams`
- Retourne `null` si combo entity+id n'a pas de route viable

### 3.2 `DrilldownLink.tsx` (composant React)

```tsx
interface DrilldownLinkProps {
  entity: DrilldownEntity;
  id: string;
  label: React.ReactNode;
  filter?: DrilldownFilter;
  icon?: boolean;            // default true — append ExternalLink lucide
  className?: string;
}
```

Comportement :
- Appelle `buildDrilldownUrl(entity, id, filter)` ; si `null` → rend `<span>{label}</span>` (pas de Link)
- Sinon rend `<Link to={url} className="...">{label}{icon && <ExternalLink size={14} />}</Link>` style sobre (`underline-on-hover`, `text-foreground`, gap-1 inline-flex)
- Permission gate **pas dans le composant** (chaque report a déjà sa PermissionGate de page) ; le drill cible vérifie la perm via son propre PermissionGate route

### 3.3 Tests unitaires `buildDrilldownUrl.test.ts` (~12 cas)

- T1-T10 : 1 cas par entity → route correcte
- T11 : filter avec `date_from/date_to` apparaît bien dans query string
- T12 : combo invalide (entity 'order' avec id vide) → `null`
- T13 : URLSearchParams handle undefined sans rajouter clé vide

---

## 4. Detail pages (Wave 2)

### 4.1 `CustomerDetailPage` (`/backoffice/customers/:id`)

**Hook** `useCustomerDetail(id)` :
- `customers` row complet (name, type, email, phone, addresses, b2b cols)
- count(`orders WHERE customer_id = id`)
- `view_ar_aging` row si `type='b2b'`

**Layout** :
- Breadcrumb : Customers › {name}
- Header card : avatar (initials), name, type badge (B2B/walk-in/account), contact (email/phone)
- Address card (si non-null) : street, city, postal
- B2B info card (si b2b) : credit_limit, current_balance, AR aging buckets (current/31-60/61-90/90+)
- Recent orders card : 10 derniers orders triés DESC `created_at` — rows clickables drill vers `orders/:id` (drill récursif niveau 2)
- Back link

**Permission gate** : `customers.read` (existe ✓)

**Sources** : 100% SELECT PostgREST (pas de RPC).

### 4.2 `OrderDetailPage` (`/backoffice/orders/:id`)

**Hook** `useOrderDetail(id)` :
- `orders` + embeds `order_items(*)` + `order_payments(*)` + `order_refunds(*)` + `customers(id, name, type)` + `users!created_by(id, name)`

**Layout** :
- Breadcrumb : Orders › #{order_number}
- Header card : `order_number`, status badge (open/completed/voided/refunded), `order_type` badge (dine_in/tablet/takeaway/b2b), `created_at`
- Customer card (si non-walk-in) : drill vers customer detail (clickable card)
- Items table : product_name, qty, unit, unit_price, line_total, modifiers JSON
- Payments table : method badge (cash/card/qris/edc/transfer/store_credit), amount, change_due (si cash), paid_at
- Refunds table (si any) : refund_number, refund_amount, reason, refunded_at, refunded_by user drill
- Total breakdown card : subtotal, discount, PB1 (10%), total
- Back link

**Permission gate** : NEW `orders.read` → seed Wave 1 migration `_010`

**Sources** : SELECT direct via PostgREST embed.

### 4.3 `RecipeDetailPage` (`/backoffice/inventory/recipes/:id`)

**Hook** `useRecipeDetail(id)` :
- `recipes` row + `recipe_versions WHERE recipe_id = id AND is_active = true LIMIT 1`
- count(`recipe_versions WHERE recipe_id = id`) pour afficher "v{n}"
- Reuse RPC `recipe_bom_full_v1` (S17) pour ingredients tree (semi-finished nested cascade)

**Layout** :
- Breadcrumb : Recipes › {name}
- Header card : name, status badge (active/draft/archived), version label (vX / Y versions)
- Yield card : yield_qty, yield_unit, batch_size (si présent)
- Ingredients tree card : arborescence depth-5 (root = ce recipe ; semi-finished children expandable), chaque row : ingredient_name, qty, unit, cost (avec drill product si ingredient_type='product')
- Allergens chips card : union allergens des ingredients (lecture depuis `products.allergens` aggregée)
- Back link

**Permission gate** : `reports.inventory.read` (existe ✓ — couvre recipes view)

**Sources** : 1 SELECT recipes + 1 RPC `recipe_bom_full_v1`.

---

## 5. Wiring drill-down par report (Wave 3)

| # | Report | Cell(s) drillable → entity cible |
|---|---|---|
| 1 | AuditPage | `actor_id` → user ; `entity_id` → varie selon `entity_type` (product/order/expense/customer) |
| 2 | BalanceSheetPage | `account_name` → account (GL `?account_id=X&date_from=Y&date_to=Z`) |
| 3 | BasketAnalysisPage | `product_a` → product detail ; `product_b` → product detail |
| 4 | CashFlowPage | `account_name` → account (GL) |
| 5 | PaymentByMethodPage | aucune cell drillable (pas de /orders list filtrée par method dans S31) — terminal |
| 6 | Pb1ReportPage | `month/year` → JE list `?date_from=Y&date_to=Z` (JournalEntries S26b existe) |
| 7 | PerishableTurnoverPage | `product_id` → product detail |
| 8 | ProductionYieldPage | `recipe_id` → recipe detail (NEW S31) ; `product_id` → product detail |
| 9 | ProfitLossPage | `account_name` → account (GL) |
| 10 | RecipeCostOverviewPage | déjà drill vers `/reports/recipe-cost/:productId` (timeline) — ajouter drill recipe detail dans la row label |
| 11 | RecipeCostTimelinePage | aucune cell drillable supplémentaire (version est terminale) |
| 12 | SalesByCategoryPage | `category_id` → products `?category_id=X&active=true` |
| 13 | SalesByHourPage | aucune cell drillable (pas de /orders list filtrée par heure dans S31) — terminal |
| 14 | SalesByStaffPage | `user_id` → user detail |
| 15 | StockMovementHistoryPage | `product_id` → product detail ; `reference_type='purchase'` → PO detail ; `reference_type='expense'` → expense detail |
| 16 | StockVariancePage | `product_id` → product detail |
| 17 | WastagePage | `product_id` → product detail (rows + lines top 500) |

**Granularité commits** :
- Wave 3.A : reports sales (SalesByCategory, SalesByHour, SalesByStaff)
- Wave 3.B : reports stock (StockMovementHistory, StockVariance, Wastage, PerishableTurnover)
- Wave 3.C : reports production (ProductionYield, RecipeCostOverview, BasketAnalysis)
- Wave 3.D : reports accounting (ProfitLoss, BalanceSheet, CashFlow, Pb1)
- Wave 3.E : autres (PaymentByMethod, AuditPage) + sidebar wire si nécessaire

---

## 6. Tests (~25 tests)

### 6.1 Unit `packages/utils` OR `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts`

12 cas (1 par entity + filter + null edge cases). Co-located dans le BO feature (helper BO-only).

### 6.2 pgTAP `supabase/tests/orders_read_perm.test.sql`

1 cas T1 : vérifie que la permission `orders.read` est seedée + grants vers MANAGER/ADMIN/SUPER_ADMIN (test post-migration `_010`).

### 6.3 BO smoke detail pages (6 cas)

- `customer-detail-page.smoke.test.tsx` (2 cas : loading + happy avec b2b balance render)
- `order-detail-page.smoke.test.tsx` (2 cas : loading + happy avec items + payments render)
- `recipe-detail-page.smoke.test.tsx` (2 cas : loading + happy avec ingredients tree depth=2)

### 6.4 BO smoke wiring sample (5 cas)

Sample 5 reports vérifient que le `<DrilldownLink>` génère bien le href attendu :
- `wastage-drilldown.smoke.test.tsx` (product drill)
- `sales-by-staff-drilldown.smoke.test.tsx` (user drill)
- `profit-loss-drilldown.smoke.test.tsx` (account drill GL)
- `perishable-turnover-drilldown.smoke.test.tsx` (product drill)
- `basket-analysis-drilldown.smoke.test.tsx` (product pair drill)

### 6.5 `pnpm typecheck` 6/6 PASS

---

## 7. Migrations (1 seule)

Block `20260616000010` :

### 7.1 `20260616000010_seed_orders_read_perm.sql`

```sql
INSERT INTO permissions (code, module, action, description) VALUES
  ('orders.read', 'orders', 'read', 'View orders')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'orders.read'
FROM roles r
WHERE r.code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
```

Note : `MANAGER+` uniquement (cohérent avec R1 §10 — gate UI BO, RLS row-level inchangée sur `orders` table). CASHIER/WAITER continuent de voir leurs propres orders en POS via les flux existants (pas de regression).

**Types regen** : `mcp__plugin_supabase_supabase__generate_typescript_types` post `_010` (mineur — étend `PermissionCode` union).

---

## 8. Waves séquentielles

### Wave 1 — Foundation (1 commit)
- 1.A : `buildDrilldownUrl.ts` + unit tests (~12 cas)
- 1.B : `DrilldownLink.tsx` composant
- 1.C : Migration `_010` seed `orders.read` + verify pgTAP 1/1 PASS via cloud MCP
- 1.D : Types regen post-migration

### Wave 2 — Detail pages (3 commits — un par page)
- 2.A : `CustomerDetailPage` + hook + route + 2 smokes
- 2.B : `OrderDetailPage` + hook + route + 2 smokes
- 2.C : `RecipeDetailPage` + hook + route + 2 smokes

### Wave 3 — Wiring (5 commits — un par groupe)
- 3.A : Sales (SalesByCategory + SalesByHour + SalesByStaff)
- 3.B : Stock (StockMovementHistory + StockVariance + Wastage + PerishableTurnover)
- 3.C : Production (ProductionYield + RecipeCostOverview + BasketAnalysis)
- 3.D : Accounting (ProfitLoss + BalanceSheet + CashFlow + Pb1)
- 3.E : Autres (PaymentByMethod + AuditPage) + 5 BO smoke wiring sample

### Wave 4 — Closeout (1 commit)
- 4.A : `pnpm typecheck` 6/6 PASS + full BO smoke regression sweep
- 4.B : CLAUDE.md Active Workplan update ("Current session: Session 31…") + INDEX `2026-05-22-session-31-INDEX.md` + status notes backlog

---

## 9. Out of scope (S32+)

| Item | Renvoi |
|---|---|
| `/backoffice/orders` list page filtrable | Backlog S32+ (débloquerait drill PaymentByMethod et SalesByHour) |
| `/recipes` standalone list refactor | Backlog (existant `/inventory/recipes` couvre déjà) |
| Actions detail pages (refund/void order, edit recipe, edit customer) | Backlog per-module |
| Mobile responsive detail pages | Vague C item futur |
| UnifiedReportFilters extra dims (category/terminal/customer) | Vague C item futur |
| Compare toggle sur 5 reports S30 (Wastage/PaymentByMethod/PB1/StockMovements/PerishableTurnover) | Vague C item futur |
| Hub mini-KPI bar + favorites/pinning | Vague C item futur |
| 6 Soon cards restantes (Daily Sales, Purchase ×3, Production Report, Staff Performance, Price Changes, Permission Change Log) | Vague C suite ou backlog |
| Drill récursif profond > 2 niveaux | Backlog (UX, pas scope wiring) |
| Drill cells terminales (PaymentByMethod method, SalesByHour bucket, RecipeCostTimeline version) | Backlog après création des list pages |

---

## 10. Risks & open questions

### R1 : `orders.read` perm scope — CASHIER+WAITER ou MANAGER+ ?
- **Risk** : Si trop large (CASHIER/WAITER), un caissier peut lire tous les orders historiques BO (RLS-bypassée par grant authenticated select sur orders). Si trop strict (MANAGER+), un waiter ne peut pas drill ses propres orders depuis SalesByStaff (mais SalesByStaff lui-même est gated `reports.read` MANAGER+, donc cohérent).
- **Décision** : MANAGER+ uniquement (reflété dans la migration §7.1).
- **Mitigation** : RLS row-level sur `orders` reste authenticated SELECT — perm UI uniquement pour montrer/masquer le menu BO. Pas de leak.

### R2 : Recipe ingredients tree perf
- `recipe_bom_full_v1` cascade depth-5 — au max ~10 ingredients × 5 levels = 50 rows. OK.
- **Mitigation** : aucun N+1, RPC retourne tout en 1 call JSONB.

### R3 : Customer drill récursif depuis Order
- `OrderDetailPage` → customer card clickable → `CustomerDetailPage` → recent orders → drill back `OrderDetailPage`. Pas de boucle infinie (URL change à chaque click + back stack browser standard).
- **Mitigation** : aucune. UX standard.

### R4 : Sidebar entries pour les 3 detail pages
- Decision : **pas d'entrée sidebar** pour `customers/:id`, `orders/:id`, `recipes/:id` — accédés uniquement par drill-down ou liens contextuels. Cohérent avec `purchase-orders/:id` (déjà pattern S13).

### R5 : `DrilldownEntity` futur scope
- Si on ajoute des entités (terminals, sections, modifiers), `DrilldownEntity` union doit étendre. Helper testable garantit non-regression. À noter dans INDEX §10.

### R6 : Cells terminales = pas de drill = régression UX
- PaymentByMethod + SalesByHour cellules principales restent texte plain dans S31 (pas de cible). Doc explicite dans INDEX §10 que ces 2 reports auront leur drill en S32+ (post `/orders` list).

---

## 11. Acceptance criteria

- [ ] `buildDrilldownUrl` helper unit tests 12/12 PASS
- [ ] `DrilldownLink` composant render conditionnel (null target → span, valid → Link)
- [ ] Migration `_010` `orders.read` seedée + pgTAP 1/1 PASS via cloud MCP
- [ ] Types regen post-migration committé
- [ ] 3 pages détail créées avec routes + breadcrumb + back link + permission gate
- [ ] 17 reports wired avec `<DrilldownLink>` (sauf cells terminales explicitement listées §5)
- [ ] BO smoke 6/6 PASS detail pages + 5/5 PASS wiring sample
- [ ] `pnpm typecheck` 6/6 PASS
- [ ] INDEX S31 + CLAUDE.md Active Workplan updated
- [ ] Deviations tracked dans INDEX §10
