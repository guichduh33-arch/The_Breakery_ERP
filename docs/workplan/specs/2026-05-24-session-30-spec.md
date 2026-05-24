# Session 30 — Vague B : 5 nouveaux reports métier bakery (Spec)

> **Date** : 2026-05-24
> **Branche cible** : `swarm/session-30`
> **Base** : `master` après merge S29 (`d14cf9b`)
> **Effort estimé** : ~2-3 jours wall-time (L)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-24-session-29-spec.md`](./2026-05-24-session-29-spec.md) — S30 enchaîne sur Vague A (compliance + exports) avec **Vague B (nouveaux reports métier)**.
> **Audit préparatoire** : recheck post-S29 dans la conversation S30 — 3/14 gaps initiaux fermés par S29 (G1, G2 partiel, G3) ; Vague B ferme G4 partiel + G11 partiel via 5 nouveaux reports.

---

## 1. Contexte

Le module Reports compte 18 pages actives post-S29 (17 + ZReportsListPage). Le hub `ReportsIndexPage` affiche encore **11 cards "Soon"** disabled. Vague B vise à **promouvoir 5 de ces 11 cards en pages actives** — les plus demandées métier :

| Card "Soon" | Section | Priorité | Bénéfice |
|---|---|---|---|
| **Wastage & Spoilage** | Inventory | P1 | KPI critique boulangerie (réduire pertes périssables) |
| **Stock Movement** | Inventory | P2 | Transparency ledger append-only |
| **Payment by Method** | Finance | P1 | Demandé quotidien opérationnel (cash/card/qris split) |
| **VAT / Tax Report** | Finance | P1 | Compliance fiscale mensuelle PB1 NON-PKP |
| (nouveau) **Perishable Turnover** | Inventory | P3 | KPI bakery (rotation lots périssables) |

**Hors scope Vague B** (renvoyé Vague C ou backlog) :
- Daily Sales, Purchase Items / by Date / by Supplier (3), Staff Performance, Production Report, Production Efficiency, Price Changes, Permission Change Log → restent "Soon"
- Compare vs previous period sur ces 5 nouveaux reports → ajouté en Vague C avec UnifiedReportFilters (évite duplication wiring)
- Drill-down navigation depuis ces reports → Vague C
- Mobile responsive → Vague C
- Scheduled email, Unusual Transactions, Custom builder → backlog Vague D

---

## 2. Architecture

**Choix structurant 1** : **1 RPC SECURITY DEFINER par report** retournant JSONB. Pattern uniforme S26-S29. Pas de views (perf + perm gate cohérent côté DB).

**Choix structurant 2** : **Réutilise infrastructure S29** — `<ExportButtons>` (CSV+PDF), helper `buildCsv`, EF `generate-pdf` avec extension à 17 templates (12 + 5 nouveaux).

**Choix structurant 3** : **Aucune nouvelle permission** — réutilise `reports.inventory.read` (3 reports) et `reports.financial.read` (2 reports).

**Choix structurant 4** : **Promotion progressive du hub** — les 5 "Soon" cards passent à `to:` actives, le hub voit immédiatement 5 → 18 actives au lieu de 13.

**Choix structurant 5** : **Pas de compare toggle Wave B** — Vague C apportera `<UnifiedReportFilters>` avec extra dims (category/terminal/customer) ; pas de wiring temporaire à dé-câbler.

### 2.1 Sources de données vérifiées (audit Explore)

| Report | Sources | Indexes existants |
|---|---|---|
| Wastage & Spoilage | `stock_movements WHERE movement_type='waste'` + `stock_lots WHERE status='expired'` | `idx_stock_movements_product(product_id, created_at DESC)` |
| Payment by Method | `order_payments (method, amount, paid_at)` | `idx_order_payments_method(method, paid_at DESC)` |
| VAT/PB1 Report | `journal_entry_lines.account_id` sur account `code='2110'` + helper `current_pb1_rate()` (S26) | journal_entries indexed on `entry_date` |
| Stock Movement | `stock_movements` ledger (sale/sale_void/production/purchase/waste/adjustment) | idx product + reference type/id |
| Perishable Turnover | `stock_lots (received_at, expires_at, status, current_qty)` + `stock_movements` consumption | idx (product_id, expires_at, status) WHERE status='active' |

---

## 3. RPCs (5 nouvelles + REVOKE pairs)

### 3.1 `get_wastage_report_v1(p_date_start TEXT, p_date_end TEXT) RETURNS JSONB`

Perm gate `reports.inventory.read`. Returns :
```json
{
  "period": { "start": "...", "end": "..." },
  "summary": {
    "total_manual_waste_qty":   100.0,
    "total_manual_waste_value": 250000,
    "total_spoilage_qty":       45.0,
    "total_spoilage_value":     112500,
    "total_qty":                145.0,
    "total_value":              362500,
    "line_count":               42
  },
  "by_product": [
    { "product_id": "...", "product_name": "...",
      "manual_waste_qty": 10, "manual_waste_value": 25000,
      "spoilage_qty": 5, "spoilage_value": 12500,
      "total_qty": 15, "total_value": 37500 }
  ],
  "lines": [
    { "id": "...", "product_id": "...", "product_name": "...",
      "type": "manual_waste|spoilage", "qty": 2.0, "value": 5000,
      "lot_id": "...", "lot_batch_number": "...", "reason": "...",
      "created_by_name": "...", "created_at": "..." }
  ]
}
```
- `manual_waste` = `stock_movements.movement_type='waste'` (humain)
- `spoilage` = `stock_lots.status='expired'` rows (auto cron)
- Value = `qty * unit_cost` (utilise `stock_movements.unit_cost` snapshot)
- `lines` limité à 500 plus récents

### 3.2 `get_payments_by_method_v1(p_date_start TEXT, p_date_end TEXT) RETURNS JSONB`

Perm gate `reports.financial.read`. Returns :
```json
{
  "period": { "start": "...", "end": "..." },
  "summary": {
    "total_amount":     15000000,
    "total_count":      850,
    "total_orders":     820
  },
  "by_method": [
    { "method": "cash", "amount": 6000000, "count": 400, "share_pct": 40.0 },
    { "method": "qris", "amount": 5000000, "count": 300, "share_pct": 33.3 },
    { "method": "card", "amount": 4000000, "count": 150, "share_pct": 26.7 }
  ],
  "by_day": [
    { "day": "2026-05-01", "cash": 200000, "card": 100000, "qris": 150000, "edc": 0, "transfer": 0, "store_credit": 0, "total": 450000 }
  ]
}
```
- `count` = number of payment rows ; `total_orders` = `COUNT(DISTINCT order_id)` (un order peut avoir plusieurs payments)
- `by_day` pour rendering chart `recharts` LineChart
- Exclut les payments des orders `status IN ('voided', 'cancelled')`

### 3.3 `get_pb1_report_v1(p_period_month INT, p_period_year INT) RETURNS JSONB`

Perm gate `reports.financial.read`. Period **mensuelle** (pas date range).
```json
{
  "period": {
    "month": 5, "year": 2026,
    "start": "2026-05-01",
    "end":   "2026-05-31"
  },
  "pb1_rate":      0.10,
  "taxable_base":  50000000,
  "pb1_collected": 5000000,
  "pb1_payable":   5000000,
  "by_day": [
    { "day": "2026-05-01", "taxable_base": 1500000, "pb1_collected": 150000 }
  ],
  "balance_account_code": "2110",
  "balance_at_period_end": 5000000
}
```
- `pb1_rate` lu depuis `current_pb1_rate()` (helper S26)
- `taxable_base` = sum of `orders.subtotal` (pre-tax) on `orders.created_at` in [start, end] et status not voided
- `pb1_collected` = sum of `orders.tax_amount`
- `pb1_payable` = match `calculate_pb1_payable_v1(p_start, p_end)` (helper S26)
- `balance_at_period_end` = current credit balance on account 2110 at end-of-period

### 3.4 `get_stock_movements_v1(p_start TEXT, p_end TEXT, p_product_id UUID?, p_movement_type TEXT?, p_limit INT DEFAULT 50, p_cursor TIMESTAMPTZ?) RETURNS JSONB`

Perm gate `reports.inventory.read`. Cursor-paginé (pattern S13 AuditLog).
```json
{
  "lines": [
    { "id": "...", "product_id": "...", "product_name": "...",
      "movement_type": "sale|sale_void|production|purchase|waste|adjustment",
      "quantity": -2.0, "unit_cost": 12500, "value": 25000,
      "lot_id": "...", "lot_batch_number": "...",
      "reference_type": "order|po|production_record", "reference_id": "...",
      "created_by_name": "...", "created_at": "2026-05-24T10:00:00Z" }
  ],
  "next_cursor": "2026-05-23T18:30:00Z"
}
```
- `quantity` signé (négatif = sortie)
- Filtres optionnels `p_product_id`, `p_movement_type`
- `LIMIT p_limit OFFSET 0` avec cursor sur `created_at`

### 3.5 `get_perishable_turnover_v1(p_date_start TEXT, p_date_end TEXT) RETURNS JSONB`

Perm gate `reports.inventory.read`. Returns :
```json
{
  "period": { "start": "...", "end": "..." },
  "by_product": [
    { "product_id": "...", "product_name": "...",
      "lots_count":         12,
      "consumed_qty":       45.0,
      "expired_qty":        5.0,
      "current_active_qty": 8.0,
      "waste_pct":          10.0,
      "avg_days_in_stock":  3.2,
      "shelf_life_days_p50": 5,
      "velocity_score":     4 }
  ]
}
```
- Périshable = produits ayant au moins un `stock_lots` avec `expires_at NOT NULL` créé dans la période
- `avg_days_in_stock` = AVG(consumed_at - received_at) sur lots `status='consumed'`
- `waste_pct` = `expired_qty / (consumed_qty + expired_qty)`
- `velocity_score` = bucket 1-5 (1=very slow, 5=very fast turnover, basé sur `avg_days_in_stock` vs `shelf_life_days_p50`)

### 3.6 REVOKE pairs canoniques (S25)

Chaque RPC en migration suivante :
```sql
REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

---

## 4. Edge Functions

**Extension** de l'EF S29 `generate-pdf` :
- Ajouter 5 templates dans `supabase/functions/_shared/pdf-templates/` :
  - `wastage.ts` (sections summary + by_product table + top spoilage lots)
  - `payment_by_method.ts` (donut share + by_method table + by_day mini-line)
  - `pb1.ts` (monthly summary + by_day breakdown + period header avec mois/année)
  - `stock_movements.ts` (table ledger, multi-page)
  - `perishable_turnover.ts` (by_product table avec velocity_score visuel)
- Update registry `index.ts` : `TemplateName` union étendu (12 → 17) + 5 entrées dans `TEMPLATES` Record + perm mapping
- Aucun nouvel EF à déployer (juste re-deploy `generate-pdf` avec nouveaux templates bundlés)

---

## 5. BackOffice

### 5.1 5 hooks nouveaux

`apps/backoffice/src/features/reports/hooks/` :
- `useWastageReport(start, end)` → `WastageReport` shape
- `usePaymentsByMethod(start, end)` → `PaymentsByMethod` shape
- `usePb1Report(month, year)` → `Pb1Report` shape
- `useStockMovements(filters)` infinite query (cursor pattern, mirror `useAuditLogs`)
- `usePerishableTurnover(start, end)` → `PerishableTurnover` shape

### 5.2 5 pages nouvelles

`apps/backoffice/src/pages/reports/` :
- `WastagePage.tsx` (route `/backoffice/reports/wastage`)
- `PaymentByMethodPage.tsx` (route `/backoffice/reports/payment-by-method`)
- `Pb1ReportPage.tsx` (route `/backoffice/reports/pb1`)
- `StockMovementHistoryPage.tsx` (route `/backoffice/reports/stock-movements`)
- `PerishableTurnoverPage.tsx` (route `/backoffice/reports/perishable-turnover`)

Pattern uniforme par page :
- `<ReportPage>` wrapper
- `<DateRangePicker>` (ou `<MonthPicker>` pour PB1)
- `<ExportButtons csv={...} pdf={template, data, period, filename} />`
- Table + (optionnel) recharts donut/line/bar
- États loading / error / empty

### 5.3 Routes + Sidebar

`apps/backoffice/src/routes/index.tsx` : 5 nouvelles `<Route>` avec PermissionGate.

`apps/backoffice/src/layouts/Sidebar.tsx` : 5 nouvelles entries indent 1 sous "Reports" :
- Wastage & Spoilage (icon `AlertTriangle`, perm `reports.inventory.read`)
- Stock Movements (icon `GitCommitHorizontal`, perm `reports.inventory.read`)
- Payment by Method (icon `Receipt`, perm `reports.financial.read`)
- VAT / PB1 (icon `FileSpreadsheet`, perm `reports.financial.read`)
- Perishable Turnover (icon `Clock4`, perm `reports.inventory.read`) — optional, sidebar peut rester à 4 entries si on veut limiter le bruit

### 5.4 Promote 5 cards "Soon" → actives sur `ReportsIndexPage`

5 modifications inline (ajouter `to:` à chaque card) :
- Inventory section : "Stock Movement" → `to: 'stock-movements'`, "Wastage & Spoilage" → `to: 'wastage'`
- Finance section : "Payment by Method" → `to: 'payment-by-method'`, "VAT / Tax Report" → `to: 'pb1'`
- Inventory section : ajouter nouvelle card "Perishable Turnover" → `to: 'perishable-turnover'` (icon `Clock4`)

Total cards actives : 13 → 18.

---

## 6. Tests

### 6.1 pgTAP (`supabase/tests/bakery_reports.test.sql`)

~15 cas total (3 par report) :
- **B.1 Wastage** : T1 happy with seeded waste + expired lots, T2 CASHIER 42501, T3 empty period returns 0 totals
- **B.2 Payment by Method** : T4 happy split methods, T5 perm denied, T6 voided orders excluded
- **B.3 PB1** : T7 happy month with sales, T8 perm denied, T9 zero-sales month returns 0
- **B.4 Stock Movement** : T10 happy paginate, T11 filter by movement_type, T12 cursor next
- **B.5 Perishable Turnover** : T13 happy with seeded lots, T14 velocity_score calc, T15 perm denied

### 6.2 BO smoke tests

5 fichiers `__tests__/<Page>.smoke.test.tsx` (2 cas par page = 10 cas) :
- render with mock data + ExportButtons present
- render empty state correctly

### 6.3 EF tests

Aucun nouveau fichier — les 5 nouveaux templates sont couverts par les tests existants S29 `generate-pdf.test.ts` (le test pnl PASS valide le path générique ; les autres templates suivent le même path).

---

## 7. Migration block

**Bloc réservé** : `20260615000010..030` (~10 migrations) :
- `_010` `create_get_wastage_report_v1_rpc` + `_011` REVOKE pair
- `_012` `create_get_payments_by_method_v1_rpc` + `_013` REVOKE pair
- `_014` `create_get_pb1_report_v1_rpc` + `_015` REVOKE pair
- `_016` `create_get_stock_movements_v1_rpc` + `_017` REVOKE pair
- `_018` `create_get_perishable_turnover_v1_rpc` + `_019` REVOKE pair

Pas de seed permissions (réutilise existantes). Régen types non requise (RPCs retournent JSONB, pas de nouvelle table).

---

## 8. Waves

| Wave | Stream | Dépendances |
|---|---|---|
| **0** | Spec + plan + branch | — |
| **1A** | DB : 3 inventory RPCs (Wastage, StockMov, PerishableTurnover) + REVOKE pairs | W0 |
| **1B** | DB : 2 finance RPCs (PaymentByMethod, PB1) + REVOKE pairs | W0 (parallèle W1A) |
| **2** | pgTAP `bakery_reports.test.sql` ~15 cas | W1A + W1B |
| **3** | EF : 5 nouveaux templates + extend registry + re-deploy `generate-pdf` | W1A + W1B (parallèle W2) |
| **4** | BO : 5 hooks + 5 pages + 5 smoke tests + ExportButtons wired | W1A + W1B + W3 (templates) |
| **5** | Promote 5 "Soon" cards on ReportsIndexPage + 5 sidebar entries + 5 routes | W4 |
| **6** | Closeout : pgTAP sweep + typecheck + INDEX + CLAUDE.md + backlog + PR | toutes |

---

## 9. Closes officiels

- **TASK-14-XXX nouveaux items** (création reports métier — voir §5 spec)
- **Gap G4 partiel** (5/11 "Soon" cards activées → reste 6)
- **Gap G11 partiel** (Wastage + Perishable Turnover closes, autres backlog)
- **Gap G12 partiel** (hub passe de 11 → 6 disabled cards)

---

## 10. Risques

- **R1** `unit_cost` snapshot dans `stock_movements` : si NULL ou stale, value calc imprecise. Mitigation : fallback à `products.cost_price` snapshot au moment du movement (pattern S17 WAC).
- **R2** PB1 monthly period boundary : si shift crosses midnight UTC vs WIB, les orders du dernier jour peuvent fuir. Mitigation : utiliser `toLocalDateStr` (S13) côté RPC + filtrer sur `entry_date` (DATE, pas TIMESTAMPTZ).
- **R3** Perishable Turnover velocity_score : algo bucket 1-5 nécessite tuning sur données réelles. Mitigation : commencer avec seuils naïfs (1=>14j, 2=8-14j, 3=4-7j, 4=2-3j, 5=<2j), itérer post-déploiement.
- **R4** Stock Movement history volume : sur 1 an la table peut avoir 100k+ lignes. Mitigation : cursor pagination LIMIT 50 + filter required (date range obligatoire).
- **R5** Re-deploy `generate-pdf` EF avec 17 templates : bundle Deno passe ~200KB → ~300KB ; cold start +50ms attendu. Si dégradation observée, split en 2 EFs (`generate-finance-pdf` + `generate-inventory-pdf`) — décidé post-déploiement.

---

## 11. Hors scope Vague B (renvoyé Vague C/backlog)

- 6 "Soon" cards non touchées : Daily Sales, Purchase Items / by Date / by Supplier, Staff Performance, Production Report, Production Efficiency, Price Changes, Permission Change Log
- Compare vs previous period sur ces 5 nouveaux reports — Vague C avec UnifiedReportFilters
- Drill-down navigation depuis ces 5 reports — Vague C
- Mobile responsive — Vague C
- Scheduled email reports (TASK-14-008) — backlog Vague D
- Unusual Transactions (TASK-14-013) — backlog
- Custom report builder (TASK-14-007) — backlog
- Velocity score tuning Perishable Turnover — itération post-prod

---

## 12. Deviations log (slot vide — rempli pendant implémentation)

| ID | Wave | Sévérité | Description | Résolution |
|---|---|---|---|---|
| _(à remplir)_ | | | | |

Convention : DEV-S30-{wave}-{seq}-{topic}. Severités : informational / low / medium / high.
