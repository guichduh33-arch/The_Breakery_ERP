---
name: reports-exports
description: >-
  Reports, exports & Z-reports expert — report RPCs, generate-pdf EF (registry de templates),
  CSV via le helper domain buildCsv, Z-report 2-step sign flow, drill-down navigation
  (buildDrilldownUrl). Guides new reports and export wiring. Use this skill whenever the
  task mentions report / rapport, export, CSV, PDF, Z-report / zreport, drill-down, sales
  report / rapport de ventes, gross margin / marge, wastage / pertes, payments by method,
  compare period / comparaison de période, dashboard report, ExportMenu / ReportShell /
  ExportButtons — or touches apps/backoffice reports|zreports features/pages, supabase
  functions generate-pdf/generate-zreport-pdf/_shared/pdf-templates, packages/domain reports,
  or any migration with report in the name. Boundary vs report-audit: THIS skill GUIDES
  building and wiring reports/exports; to DIAGNOSE a broken or inaccurate existing report
  (dead RPC/view binding, a chart that doesn't match the data, a decorative date filter) →
  report-audit. Invoke it BEFORE adding or modifying any report RPC, PDF template, or export
  button.
pathPatterns:
  - 'apps/backoffice/src/features/reports/**'
  - 'apps/backoffice/src/pages/reports/**'
  - 'apps/backoffice/src/features/zreports/**'
  - 'apps/backoffice/src/pages/zreports/**'
  - 'supabase/functions/generate-pdf/**'
  - 'supabase/functions/generate-zreport-pdf/**'
  - 'supabase/functions/_shared/pdf-templates/**'
  - 'supabase/migrations/*report*.sql'
  - 'supabase/migrations/*zreport*.sql'
  - 'packages/domain/src/reports/**'
promptSignals:
  phrases:
    - 'report'
    - 'export'
    - 'CSV'
    - 'PDF'
    - 'Z-report'
    - 'zreport'
    - 'drill-down'
    - 'drilldown'
    - 'generate-pdf'
    - 'ExportMenu'
    - 'ExportButtons'
    - 'ReportShell'
    - 'PeriodControl'
    - 'buildCsv'
    - 'compare period'
    - 'wastage report'
    - 'payment by method'
    - 'perishable turnover'
    - 'previousPeriod'
    - 'DrilldownLink'
---

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

## Critical patterns (vérifiés, ne pas enfreindre)

1. **Chaque RPC report a un REVOKE pair canonique** (3 lignes : `FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES`). Vérifier que toute nouvelle RPC report suit le même bloc.

2. **`buildCsv` est IO-free et dans `packages/domain`** — ne jamais ajouter de fetch/import Supabase. `downloadCsv` déclenche le download navigateur (guard `typeof window`).

3. **`generate-pdf` rate-limit 30/min durable par IP** (helper `_shared/rate-limit.ts` → `checkRateLimitDurable` → famille RPC `record_rate_limit`). Bucket `reports-exports/` TTL 30j. Ajout d'un template = ajouter dans le registry `TEMPLATES` de `index.ts` + permission correspondante.

4. **Génération du PDF Z-report non bloquante** : l'échec de l'EF est avalé (`console.warn`) côté POS — le draft row reste en DB pour retry BO via `useGenerateZReportPdf`. Ne pas rendre le flow POS bloquant.

5. **PIN en header `x-manager-pin`, jamais en body JSON, pour les EF.** Exception documentée ci-dessus : le sign/void Z-report passe par une RPC et prend le PIN en argument.

6. **L'ossature d'un report est `<ReportShell>` + `<ExportMenu>`, pas `<ExportButtons>`.**
   `ReportShell` (`features/reports/components/`) porte fil d'Ariane → bandeau (PageHeader + toolbar) → bannière d'erreur `role="alert"` unifiée → bande KPI → corps, avec `isEmpty`/`emptyState`. `ExportMenu` est **un** bouton ouvrant un menu CSV / PDF, au cran **SECONDAIRE** (l'encre va à la tuile KPI héro — The One Ink Fill Rule). Sans `reports.export`, il se **désactive et dit pourquoi**, il ne disparaît pas.
   `ExportButtons` (deux boutons ghost, masquage silencieux sans permission) est l'ancêtre : au 2026-08-31 il ne survit que dans `pages/inventory/MarginWatchPage.tsx` et `pages/inventory/StockMovementsPage.tsx`, plus son helper `exportErrorDetail` que `ExportMenu` réimporte. **Ne pas l'employer sur une page neuve, et ne pas créer de bouton export ad-hoc.**

7. **Compare period : `<PeriodControl>`.** `DateRangePickerWithCompare` **n'existe plus** — `PeriodControl` (bouton calendrier 32 px + panneau presets/plage libre, bouton « Compare » à côté porté par `aria-pressed`) l'a remplacé avec `DateRangePicker` et les deux checkbox maison du module. Le compare n'est plus l'affaire de 5 pages : il touche la large majorité des pages de rapport — pour un décompte, `grep -rl "compare" apps/backoffice/src/pages/reports/*.tsx`, jamais un nombre gravé ici. `previousPeriod` est calendar-aware (mois complet vs n-day shift).

---

## Checklists (avant de livrer)

### A — Ajouter un nouveau report BO

- [ ] RPC `get_<name>_v1` SECURITY DEFINER + gate `reports.<domain>.read` + REVOKE pair + `audit_logs`
- [ ] Hook React Query (`use<Name>Report`) dans `apps/backoffice/src/features/reports/hooks/`
- [ ] Page dans `apps/backoffice/src/pages/reports/<Name>Page.tsx` montée sur `<ReportShell>`, avec `<ExportMenu>` et `<PeriodControl>` dans le `toolbar`
- [ ] Route dans `src/routes/index.tsx` + `<PermissionGate required="reports.<domain>.read">` (la prop est **`required`**, pas `gate`)
- [ ] Sidebar entry (groupe Reports, indent 1) + tile dans `ReportsIndexPage` hub
- [ ] pgTAP : happy path + perm denied + shape (colonnes retournées) + clamp dates
- [ ] Template PDF dans `pdf-templates/<name>.ts` + enregistrer dans le registry `TEMPLATES` si PDF requis

### B — Ajouter un template `generate-pdf`

- [ ] Créer `supabase/functions/_shared/pdf-templates/<name>.ts` (exporte `render`)
- [ ] Ajouter l'import + l'entrée dans `TemplateName` **et** dans `TEMPLATES` dans `index.ts`, avec la permission correcte
- [ ] Tester via Vitest live `supabase/tests/functions/generate-pdf.test.ts` (env-gated)

### C — Wiring drill-down sur un report

- [ ] Identifier l'entity target (`DrilldownEntity` — si nouvelle, l'ajouter au type ET à la bonne table de routes dans `buildDrilldownUrl.ts` : détail, liste-par-id, ou filter-only)
- [ ] Ajouter le cas dans `features/reports/utils/__tests__/buildDrilldownUrl.test.ts`
- [ ] Wrapper la cellule avec `<DrilldownLink entity=... id=... filter=...>`

---

## Sources de vérité (pointeurs)

```
Migrations — repère la PLUS HAUTE de chaque famille avant d'écrire :
  ls supabase/migrations | grep -Ei "wastage|payments_by_method|pb1|stock_movement|perishable|orders_list|zreport"

BO — ossature et export
  apps/backoffice/src/features/reports/components/ReportShell.tsx       # archétype Report
  apps/backoffice/src/features/reports/components/ExportMenu.tsx        # standard export
  apps/backoffice/src/features/reports/components/PeriodControl.tsx     # période + compare
  apps/backoffice/src/features/reports/components/ExportButtons.tsx     # ancêtre + exportErrorDetail
  apps/backoffice/src/features/reports/components/DrilldownLink.tsx
  apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts
  apps/backoffice/src/features/reports/hooks/                           # un hook par famille RPC
  apps/backoffice/src/pages/reports/                                    # les pages + ReportsIndexPage (hub)

Domain helpers (pure TS)
  packages/domain/src/reports/                                          # façade index.ts

Z-report
  apps/pos/src/features/shift/hooks/useCloseShift.ts                    # chaîne l'EF, non bloquant
  apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts
  apps/backoffice/src/features/cash-register/hooks/useVoidZReport.ts
  apps/backoffice/src/features/cash-register/hooks/useGenerateZReportPdf.ts

PDF
  supabase/functions/_shared/pdf-templates/index.ts   # registry = source of truth
  supabase/functions/generate-pdf/index.ts
  supabase/functions/generate-zreport-pdf/index.ts

Tests SQL (liste vivante : ls supabase/tests | grep -Ei "report|zreport|orders_list|pb1|payment")
  supabase/tests/zreports.test.sql
  supabase/tests/sign_zreport_pin.test.sql
  supabase/tests/void_zreport_v2_manager_pin.test.sql
  supabase/tests/bakery_reports.test.sql
  supabase/tests/orders_list_v4.test.sql  (+ _envelope, _sort)
  supabase/tests/payments_by_method_v3_timezone.test.sql
  supabase/tests/refunds_report.test.sql

Test unitaire drill-down
  apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts
```

---

## Verification before completion

```bash
# Type check
pnpm typecheck

# Domain unit (buildCsv + previousPeriod + agrégations)
pnpm --filter @breakery/domain test reports

# BO smoke — report pages (les fichiers de test sont souvent en kebab-case :
# localiser par glob, un filtre sur le nom de composant en rate la moitié)
pnpm --filter @breakery/app-backoffice test reports

# Z-reports BO
pnpm --filter @breakery/app-backoffice test zreports

# Drill-down unit
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```

La suite **BO complète** tourne en local (~5-6 min) et c'est le seul filet qui voit une régression inter-fichiers : la lancer avant de conclure.

Vitest live EF tests (`generate-pdf`, `generate-zreport-pdf`, `sign-zreport`) nécessitent `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportés (env-gated).

---

## When to escalate

- Ajout d'un nouveau bucket Storage ou changement de TTL/retention (conformité 7 ans zreports)
- Bump RPC report majeur (changement de signature → `_vN+1` + DROP `_vN` dans la même migration)
- Nouveau `DrilldownEntity` qui pointe vers une page inexistante
- Changement de la permission `reports.*` seedée (impact RBAC transverse)
- `generate-pdf` rate-limit insuffisant pour le trafic prod (30/min durable)
