# reports-exports — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Mental model — Pipeline reports & exports
- Surface map

# Reports & Exports — The Breakery ERP

> **Relevé re-vérifié contre le code le 2026-08-31.** Chaque fait ci-dessous a été
> recoupé sur la migration au numéro le PLUS HAUT de sa famille **et** sur son
> call-site front. Un chiffre ou une version qui contredit le code : **le code
> gagne**, ce fichier a tort. Les objets versionnés sont désignés par **famille**
> (`get_wastage_report`, pas `_v2`) : les bumps sont fréquents, on relit la
> migration la plus haute + le hook avant de se fier à un numéro.

Expert on the reports/exports pipeline: report RPCs, PDF generation, CSV exports, Z-report sign flow, and drill-down navigation across the BO reports surface.

**`CLAUDE.md` est la source de vérité** pour les patterns globaux (REVOKE pair, idempotency 2-flavors, PIN header, RPC versioning). Ce skill ajoute la surface map reports/exports, les checklists métier, et les pointeurs vers les fichiers réels.

---

## Mental model — Pipeline reports & exports

```
RPC (SECURITY DEFINER)          Domain helpers (IO-free)         EF Deno
──────────────────────          ────────────────────────         ────────
get_wastage_report              buildCsv<T>(rows, cols, opts?)   generate-pdf
get_payments_by_method           ↓ RFC 4180 + UTF-8 BOM            ↓ registry TEMPLATES
get_pb1_report                   ↓ id-ID locale (IDR)              ↓ rate-limit 30/min durable
get_stock_movement_ledger        previousPeriod(start, end)        ↓ bucket reports-exports/ TTL 30j
get_perishable_turnover          formatDelta(curr, prev) → Delta
get_orders_list                 downloadCsv(csv, filename)       generate-zreport-pdf
                                                                    ↓ idempotent x-idempotency-key
                                buildDrilldownUrl(entity, id,       ↓ bucket zreports/ 7 ans
                                  filter?) → string|null
                                DrilldownLink component
```

---

## Surface map

### Domain helpers — `packages/domain/src/reports/`
| Fichier | Exports (façade : `index.ts`) |
|---------|-------------------------------|
| `csv.ts` | `buildCsv<T>`, `downloadCsv`, `CsvColumn<T>`, `CsvFormat`, `CsvOptions` |
| `period.ts` | `previousPeriod(start, end)`, `formatDelta(curr, prev) → Delta` |
| `toLocalDateStr.ts` | `toLocalDateStr`, `toLocalDayStartUTC`, `toLocalDayEndUTC`, `DEFAULT_TIMEZONE` |
| `aggregations.ts` | `sumByHour`, `sumByCategory`, `sumByStaff`, `computeStockVariance` |
| `customerSales.ts` | `CUSTOMER_CHURN_MIN_PREV_ORDERS` |
| `purchasePrices.ts` | `PURCHASE_PRICE_RISE_THRESHOLD_PCT`, `classifyPriceDelta`, `weightedInflationPct`, `risingSpendSharePct` |

`index.ts` réexporte tout : la liste ci-dessus vaut inventaire de fichiers, **la façade fait foi** pour ce qui est réellement exporté.

`buildDrilldownUrl` et `DrilldownLink` sont dans **`apps/backoffice/src/features/reports/`**, PAS dans `packages/domain`. IO-free rule tenue : tout `packages/domain/src/reports/` est du TS pur, pas de fetch/Supabase.

### EF `generate-pdf` — `supabase/functions/_shared/pdf-templates/`

**Le registry `TEMPLATES` de `index.ts` est la source de vérité** — le lire, ne pas se fier à un décompte écrit ici. Les permissions y sont déclarées par entrée :

| Permission | Templates enregistrés |
|------------|-----------------------|
| `reports.financial.read` | `pnl`, `bs`, `cf`, `recipe_overview`, `recipe_timeline`, `payment_by_method`, `pb1` |
| `reports.sales.read` | `basket`, `sales_by_hour`, `sales_by_category`, `sales_by_staff` |
| `reports.inventory.read` | `wastage`, `stock_variance`, `stock_movements`, `perishable_turnover` |
| `reports.audit.read` | `audit` |
| `inventory.read` | `production_yield` |
| `b2b.read` | `b2b_invoice` |
| `orders.reprint_receipt` | `receipt` (reçu duplicata ; `reports.export` tient le second verrou) |

`zreport.ts` existe dans le dossier mais est utilisé UNIQUEMENT par `generate-zreport-pdf` — il n'est **pas** dans le registry.

### Report RPCs (toutes SECURITY DEFINER + REVOKE pair canonique)

Familles, avec leur gate. **Vérifier la version live** dans `supabase/migrations/` (numéro le plus haut) **et** le hook appelant avant d'écrire du code.

| Famille RPC | Gate | Cursor |
|-------------|------|--------|
| `get_wastage_report` | `reports.inventory.read` | non |
| `get_payments_by_method` | `reports.financial.read` | non (pivot by_day : méthodes + `other` + total ; volet frais/wallets) |
| `get_pb1_report` | `reports.financial.read` | non (mois/année) |
| `get_stock_movement_ledger` | `inventory.read` **OU** `reports.inventory.read` | non (requête unique, filtrée) |
| `get_stock_movements` | `reports.inventory.read` | oui — keyset `(created_at, id)` via token TEXT `"<created_at>\|<id>"` |
| `get_perishable_turnover` | `reports.inventory.read` | non |
| `get_orders_list` | `orders.read` | oui — keyset générique `(valeur_de_tri, id)` + `p_sort`/`p_dir` blanc-listés |

**Piège `get_stock_movements` vs `get_stock_movement_ledger`.** Deux familles distinctes, pas deux versions :
- `get_stock_movement_ledger` est le chemin **vivant** du feed BO — `useStockLedger` (`features/inventory-movements/hooks/`) l'appelle, et c'est par lui que passent `StockMovementHistoryPage` (reports) et `StockMovementsPage` (inventory).
- La famille `get_stock_movements` existe toujours en base ; côté front seul `useStockMovementsFeed` la référence encore. **Ne pas y brancher un nouveau report** — partir du ledger.

`get_orders_list` est un cas hybride — scope orders mais consommé par un report drill-down (`order_list` entity), via `useOrdersList` (`features/orders/hooks/`). Voir skill `orders` pour l'édition et la liste BO.

### Z-report flow 2 temps

1. `close_shift` (famille) → INSERT draft row `z_reports` (snapshot JSONB figé via le helper `_build_zreport_snapshot` : orders + payments + refunds + expenses du shift)
2. **Le POS chaîne l'EF côté client**, pas la DB : `useCloseShift` (`apps/pos/src/features/shift/hooks/`) fait `supabase.functions.invoke('generate-zreport-pdf')` en fire-and-forget après un `close_shift` réussi, avec `x-idempotency-key` → PDF → bucket `zreports/` 7 ans (conformité Indonésie). Aucun `pg_net` n'est impliqué.
3. Manager signe via BO → famille `sign_zreport` (gate `zreports.sign`, audit `audit_logs`, replay idempotent)
4. Optionnel : famille `void_zreport` (reason ≥ 10 chars, gate **`zreports.void`**)
5. Famille `get_zreport_snapshot` (gate `zreports.read`)

Perms seedées : `zreports.{read, sign, void}` — `void` réservée ADMIN/SUPER_ADMIN.

**Le PIN manager du sign/void Z-report est un ARGUMENT de RPC, pas un header.** C'est l'exception au pattern PIN-in-header : les bumps `sign_zreport` / `void_zreport` ont déplacé le PIN en argument validé serveur (`verify_user_pin` / `_verify_pin_with_lockout`) précisément parce que le header `x-manager-pin` visait un EF wrapper jamais déployé — la signature se faisait donc **sans PIN réel**. Le pattern header reste la règle partout où le PIN traverse une **EF** (`cancel-item`, refund, void order, mint d'autorisation).

### Drill-down navigation

`buildDrilldownUrl(entity, id, filter?)` — le type `DrilldownEntity` de `buildDrilldownUrl.ts` fait foi pour la liste des entités. Trois familles de cibles :
- **détail** (`product`, `user`, `supplier`, `expense`, `purchase_order`, `customer`, `order`, `recipe`) — id requis
- **liste filtrée par id** (`category`, `account`)
- **filter-only** (`order_list`, `b2b_invoices`, `cash_treasury`) — id ignoré, URL = route de base + params

Retourne `null` si combo non viable → `DrilldownLink` affiche texte brut.

---
